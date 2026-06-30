#region Using declarations
using System;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Media;
using NinjaTrader.Data;
using NinjaTrader.Gui.Chart;
using NinjaTrader.Gui.Tools;
using NinjaTrader.NinjaScript;
using NinjaTrader.NinjaScript.DrawingTools;
using NinjaTrader.NinjaScript.Indicators;
#endregion

// ============================================================================
// DEGOLD_M15_DIRECTIONAL_COMPASS_8010_V1
// Plataforma: NinjaTrader 8
// Objetivo: Marcar sentido institucional do mercado no M15 para intraday.
// Pipeline: REGIME -> STRUCTURE -> VWAP/LOCATION -> FLOW -> ACCEPTANCE -> PYTHON 8010 CONTEXT
// Observação: Indicador de leitura direcional. Não executa ordens.
// ============================================================================

namespace NinjaTrader.NinjaScript.Indicators
{
    public class DEGOLD_M15_Directional_Compass_8010_V1 : Indicator
    {
        private EMA ema9;
        private EMA ema21;
        private EMA ema50;
        private EMA ema200;
        private SMA volSma;
        private ATR atr;
        private ADX adx;
        private OBV obv;

        private double cumPV;
        private double cumVol;
        private double sessionVWAP;
        private DateTime currentDate = Core.Globals.MinDate;

        private double cvdProxy;
        private double cvdProxyPrev;
        private double lastScore;
        private int lastDirection; // 1 compra, -1 venda, 0 neutro
        private int lastSignalBar = -9999;

        private string marketState = "NEUTRO";
        private string decision = "AGUARDAR";
        private string reason = "INICIALIZANDO";
        private string pythonState = "OFFLINE";
        private string dealerBias = "NEUTRO";
        private string gammaRegime = "UNKNOWN";
        private string vixRegime = "UNKNOWN";
        private string visualConfirmSide = "NEUTRO";
        private bool vixBlock;
        private double bridgeAuthority;
        private double dealerSignalScore;
        private double visualConfirmPercent;
        private DateTime lastPythonFetch = Core.Globals.MinDate;
        private bool pythonFetchInFlight;
        private string lastPythonError = "SEM ERRO";

        private static readonly HttpClient http = new HttpClient();

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name                     = "DEGOLD_M15_Directional_Compass_8010_V1";
                Description              = "Bússola direcional institucional M15 com score DeGold e contexto Python 8010.";
                Calculate                = Calculate.OnBarClose; // no-repaint por fechamento
                IsOverlay                = true;
                DrawOnPricePanel         = true;
                DisplayInDataBox         = true;
                PaintPriceMarkers        = false;
                IsSuspendedWhileInactive = true;

                FastEma                  = 9;
                SlowEma                  = 21;
                MidEma                   = 50;
                MacroEma                 = 200;
                VolumeMAPeriod           = 20;
                AtrPeriod                = 14;
                AdxPeriod                = 14;
                StructureLookback        = 20;
                CompressionLookback      = 12;
                MinDirectionalScore      = 72.0;
                UltraScore               = 84.0;
                MinScoreSpread           = 13.0;
                MinAdxTrend              = 18.0;
                StrongAdxTrend           = 24.0;
                MinBodyRatio             = 0.52;
                VolumeImpulseMult        = 1.15;
                VwapSlopeLookback        = 4;
                MaxDistanceFromVWAPAtr   = 1.85;
                UsePython8010            = true;
                PythonUrl                = "http://127.0.0.1:8010/dealer-flow?symbol=QQQ&limit=120&include_cross=true";
                PythonRefreshBars        = 4;
                PythonContextWeight      = 0.18;
                TreatPythonAsContextOnly = true;
                BlockOnVixBlock          = true;
                PaintBars                = true;
                ShowPanel                = true;
                ShowSignals              = true;
                ShowVWAP                 = true;
                ShowEMAs                 = true;
                SignalCooldownBars       = 3;

                AddPlot(Brushes.DodgerBlue, "DirecaoScore");
                AddPlot(Brushes.Gray, "ScoreSpread");
            }
            else if (State == State.Configure)
            {
                http.Timeout = TimeSpan.FromMilliseconds(1200);
            }
            else if (State == State.DataLoaded)
            {
                ema9   = EMA(FastEma);
                ema21  = EMA(SlowEma);
                ema50  = EMA(MidEma);
                ema200 = EMA(MacroEma);
                volSma = SMA(Volume, VolumeMAPeriod);
                atr    = ATR(AtrPeriod);
                adx    = ADX(AdxPeriod);
                obv    = OBV();
            }
        }

        protected override void OnBarUpdate()
        {
            if (CurrentBar < Math.Max(MacroEma, Math.Max(StructureLookback, VolumeMAPeriod)) + 10)
                return;

            ResetSessionVWAPIfNeeded();
            UpdateSessionVWAP();
            UpdateCvdProxy();

            if (UsePython8010 && CurrentBar % Math.Max(1, PythonRefreshBars) == 0)
                FetchPythonContextAsync();

            double buyScore = 0.0;
            double sellScore = 0.0;
            string buyReasons = "";
            string sellReasons = "";

            double range = High[0] - Low[0];
            double body = Math.Abs(Close[0] - Open[0]);
            double bodyRatio = range > TickSize ? body / range : 0.0;
            double upperWick = High[0] - Math.Max(Open[0], Close[0]);
            double lowerWick = Math.Min(Open[0], Close[0]) - Low[0];
            double upperWickRatio = range > TickSize ? upperWick / range : 0.0;
            double lowerWickRatio = range > TickSize ? lowerWick / range : 0.0;
            bool bullCandle = Close[0] > Open[0];
            bool bearCandle = Close[0] < Open[0];
            bool strongBody = bodyRatio >= MinBodyRatio;
            bool highVolume = Volume[0] >= volSma[0] * VolumeImpulseMult;
            bool aboveVWAP = Close[0] > sessionVWAP;
            bool belowVWAP = Close[0] < sessionVWAP;
            double vwapSlopeTicks = CurrentBar > VwapSlopeLookback ? (sessionVWAP - GetSessionVWAPApprox(VwapSlopeLookback)) / TickSize : 0.0;
            double atrValue = Math.Max(atr[0], TickSize);
            double distanceVWAPAtr = Math.Abs(Close[0] - sessionVWAP) / atrValue;

            bool emaBullStack = ema9[0] > ema21[0] && ema21[0] > ema50[0] && ema50[0] > ema200[0];
            bool emaBearStack = ema9[0] < ema21[0] && ema21[0] < ema50[0] && ema50[0] < ema200[0];
            bool emaBullSlope = ema21[0] > ema21[3] && ema50[0] > ema50[5];
            bool emaBearSlope = ema21[0] < ema21[3] && ema50[0] < ema50[5];

            double recentHigh = MAX(High, StructureLookback)[1];
            double recentLow  = MIN(Low, StructureLookback)[1];
            bool bosUp = Close[0] > recentHigh + TickSize;
            bool bosDown = Close[0] < recentLow - TickSize;
            bool closeNearHigh = range > TickSize && (High[0] - Close[0]) / range <= 0.25;
            bool closeNearLow  = range > TickSize && (Close[0] - Low[0]) / range <= 0.25;

            bool obvUp = obv[0] > obv[3] && obv[3] > obv[6];
            bool obvDown = obv[0] < obv[3] && obv[3] < obv[6];
            bool cvdUp = cvdProxy > cvdProxyPrev;
            bool cvdDown = cvdProxy < cvdProxyPrev;

            bool adxTrend = adx[0] >= MinAdxTrend;
            bool adxStrong = adx[0] >= StrongAdxTrend;
            bool expansion = range >= atrValue * 0.75 && highVolume;
            bool compressionBreakUp = IsCompressed() && bosUp && bullCandle;
            bool compressionBreakDown = IsCompressed() && bosDown && bearCandle;

            // REGIME / EMAS
            if (emaBullStack) { buyScore += 16; buyReasons += "EMA_STACK_UP "; }
            if (emaBearStack) { sellScore += 16; sellReasons += "EMA_STACK_DOWN "; }
            if (emaBullSlope) { buyScore += 8; buyReasons += "EMA_SLOPE_UP "; }
            if (emaBearSlope) { sellScore += 8; sellReasons += "EMA_SLOPE_DOWN "; }

            // VWAP / LOCATION
            if (aboveVWAP) { buyScore += 12; buyReasons += "ACIMA_VWAP "; }
            if (belowVWAP) { sellScore += 12; sellReasons += "ABAIXO_VWAP "; }
            if (vwapSlopeTicks > 1.0) { buyScore += 6; buyReasons += "VWAP_SLOPE_UP "; }
            if (vwapSlopeTicks < -1.0) { sellScore += 6; sellReasons += "VWAP_SLOPE_DOWN "; }
            if (distanceVWAPAtr > MaxDistanceFromVWAPAtr)
            {
                buyScore -= 7;
                sellScore -= 7;
            }

            // ESTRUTURA / BOS
            if (bosUp) { buyScore += 14; buyReasons += "BOS_UP "; }
            if (bosDown) { sellScore += 14; sellReasons += "BOS_DOWN "; }
            if (compressionBreakUp) { buyScore += 8; buyReasons += "COMPRESSAO_ROMPIDA_UP "; }
            if (compressionBreakDown) { sellScore += 8; sellReasons += "COMPRESSAO_ROMPIDA_DOWN "; }

            // FORÇA DE CANDLE / ACEITAÇÃO
            if (bullCandle && strongBody && closeNearHigh) { buyScore += 12; buyReasons += "ACEITACAO_ALTA "; }
            if (bearCandle && strongBody && closeNearLow) { sellScore += 12; sellReasons += "ACEITACAO_BAIXA "; }
            if (bullCandle && highVolume) { buyScore += 7; buyReasons += "VOL_COMPRA "; }
            if (bearCandle && highVolume) { sellScore += 7; sellReasons += "VOL_VENDA "; }

            // FLUXO / OBV / CVD PROXY
            if (obvUp) { buyScore += 9; buyReasons += "OBV_UP "; }
            if (obvDown) { sellScore += 9; sellReasons += "OBV_DOWN "; }
            if (cvdUp) { buyScore += 7; buyReasons += "CVD_PROXY_UP "; }
            if (cvdDown) { sellScore += 7; sellReasons += "CVD_PROXY_DOWN "; }

            // ADX / EXPANSÃO
            if (adxTrend && emaBullSlope) { buyScore += 6; buyReasons += "ADX_TREND_UP "; }
            if (adxTrend && emaBearSlope) { sellScore += 6; sellReasons += "ADX_TREND_DOWN "; }
            if (adxStrong && expansion && bullCandle) { buyScore += 7; buyReasons += "EXPANSAO_UP "; }
            if (adxStrong && expansion && bearCandle) { sellScore += 7; sellReasons += "EXPANSAO_DOWN "; }

            // TRAP / EXAUSTÃO: pavio contra direção reduz convicção
            if (bullCandle && upperWickRatio >= 0.42 && !bosUp) buyScore -= 8;
            if (bearCandle && lowerWickRatio >= 0.42 && !bosDown) sellScore -= 8;

            // PYTHON 8010 COMO CONTEXTO
            ApplyPythonContext(ref buyScore, ref sellScore, ref buyReasons, ref sellReasons);

            buyScore = Clamp(buyScore, 0, 100);
            sellScore = Clamp(sellScore, 0, 100);
            double dominantScore = Math.Max(buyScore, sellScore);
            double spread = Math.Abs(buyScore - sellScore);
            int direction = 0;

            if (buyScore >= MinDirectionalScore && spread >= MinScoreSpread && buyScore > sellScore)
                direction = 1;
            else if (sellScore >= MinDirectionalScore && spread >= MinScoreSpread && sellScore > buyScore)
                direction = -1;

            if (BlockOnVixBlock && vixBlock && TreatPythonAsContextOnly == false)
                direction = 0;

            lastDirection = direction;
            lastScore = dominantScore;
            Values[0][0] = direction == 1 ? dominantScore : direction == -1 ? -dominantScore : 0;
            Values[1][0] = spread;

            if (direction == 1)
            {
                marketState = dominantScore >= UltraScore ? "COMPRA ULTRA" : "COMPRA FORTE";
                decision = "SOMENTE COMPRA / PULLBACK A FAVOR";
                reason = buyReasons.Trim();
            }
            else if (direction == -1)
            {
                marketState = dominantScore >= UltraScore ? "VENDA ULTRA" : "VENDA FORTE";
                decision = "SOMENTE VENDA / PULLBACK A FAVOR";
                reason = sellReasons.Trim();
            }
            else
            {
                marketState = spread < 8 ? "BALANCE / BRIGA" : "TRANSICAO";
                decision = "AGUARDAR";
                reason = "Sem edge direcional limpo | Buy " + buyScore.ToString("0") + " x Sell " + sellScore.ToString("0");
            }

            PaintAndDraw(direction, dominantScore, spread, buyScore, sellScore);
        }

        private void ApplyPythonContext(ref double buyScore, ref double sellScore, ref string buyReasons, ref string sellReasons)
        {
            if (!UsePython8010 || pythonState != "ONLINE")
                return;

            double w = Clamp(PythonContextWeight, 0.0, 0.35);
            double dealerBoost = Clamp(dealerSignalScore, 0, 100) * w;
            double visualBoost = Clamp(visualConfirmPercent, 0, 100) * w * 0.45;

            if (IsBullText(dealerBias) || IsBullText(visualConfirmSide))
            {
                buyScore += dealerBoost + visualBoost;
                buyReasons += "PY8010_BULL ";
                if (IsBearText(gammaRegime)) buyScore -= 4;
            }
            else if (IsBearText(dealerBias) || IsBearText(visualConfirmSide))
            {
                sellScore += dealerBoost + visualBoost;
                sellReasons += "PY8010_BEAR ";
                if (IsBullText(gammaRegime)) sellScore -= 4;
            }

            if (vixBlock)
            {
                buyScore -= TreatPythonAsContextOnly ? 5 : 15;
                sellScore -= TreatPythonAsContextOnly ? 5 : 15;
            }
        }

        private async void FetchPythonContextAsync()
        {
            if (pythonFetchInFlight || string.IsNullOrWhiteSpace(PythonUrl))
                return;

            pythonFetchInFlight = true;
            try
            {
                string json = await http.GetStringAsync(PythonUrl);
                dealerBias = ExtractJsonString(json, "dealer_bias", dealerBias);
                gammaRegime = ExtractJsonString(json, "gamma_regime", gammaRegime);
                vixRegime = ExtractJsonString(json, "vix_regime", vixRegime);
                visualConfirmSide = ExtractJsonString(json, "visual_confirm_side", visualConfirmSide);
                bridgeAuthority = ExtractJsonDouble(json, "bridge_authority", bridgeAuthority);
                dealerSignalScore = ExtractJsonDouble(json, "signal_score", dealerSignalScore);
                visualConfirmPercent = ExtractJsonDouble(json, "visual_confirm_percent", visualConfirmPercent);
                vixBlock = ExtractJsonBool(json, "vix_block", vixBlock);
                pythonState = "ONLINE";
                lastPythonError = "SEM ERRO";
                lastPythonFetch = DateTime.Now;
            }
            catch (Exception ex)
            {
                pythonState = "OFFLINE";
                lastPythonError = ex.Message.Length > 70 ? ex.Message.Substring(0, 70) : ex.Message;
            }
            finally
            {
                pythonFetchInFlight = false;
            }
        }

        private void UpdateCvdProxy()
        {
            cvdProxyPrev = cvdProxy;
            double range = Math.Max(High[0] - Low[0], TickSize);
            double closeLocation = ((Close[0] - Low[0]) / range) - 0.5; // -0.5 a +0.5
            double signedVol = closeLocation * 2.0 * Volume[0];
            cvdProxy += signedVol;
        }

        private void ResetSessionVWAPIfNeeded()
        {
            if (currentDate.Date != Time[0].Date)
            {
                currentDate = Time[0].Date;
                cumPV = 0;
                cumVol = 0;
                sessionVWAP = Close[0];
                cvdProxy = 0;
                cvdProxyPrev = 0;
            }
        }

        private void UpdateSessionVWAP()
        {
            double typical = (High[0] + Low[0] + Close[0]) / 3.0;
            cumPV += typical * Volume[0];
            cumVol += Math.Max(Volume[0], 1);
            sessionVWAP = cumPV / cumVol;
        }

        private double GetSessionVWAPApprox(int barsAgo)
        {
            if (barsAgo <= 0 || CurrentBar <= barsAgo)
                return sessionVWAP;

            double pv = 0;
            double v = 0;
            int max = Math.Min(CurrentBar, barsAgo + 15);
            for (int i = barsAgo; i < max; i++)
            {
                double typical = (High[i] + Low[i] + Close[i]) / 3.0;
                pv += typical * Math.Max(Volume[i], 1);
                v += Math.Max(Volume[i], 1);
            }
            return v > 0 ? pv / v : sessionVWAP;
        }

        private bool IsCompressed()
        {
            if (CurrentBar < CompressionLookback + 2)
                return false;
            double hi = MAX(High, CompressionLookback)[1];
            double lo = MIN(Low, CompressionLookback)[1];
            double width = hi - lo;
            return width <= atr[0] * 1.25 && adx[0] < StrongAdxTrend + 4;
        }

        private void PaintAndDraw(int direction, double dominantScore, double spread, double buyScore, double sellScore)
        {
            Brush barBrush = Brushes.Gray;
            if (direction == 1) barBrush = dominantScore >= UltraScore ? Brushes.LimeGreen : Brushes.DodgerBlue;
            else if (direction == -1) barBrush = dominantScore >= UltraScore ? Brushes.Red : Brushes.OrangeRed;
            else if (marketState.StartsWith("BALANCE")) barBrush = Brushes.Goldenrod;

            if (PaintBars)
            {
                BarBrush = barBrush;
                CandleOutlineBrush = barBrush;
            }

            if (ShowVWAP)
                Draw.Line(this, "DG_VWAP_" + CurrentBar, false, 1, sessionVWAP, 0, sessionVWAP, Brushes.Gold, DashStyleHelper.Solid, 2);

            if (ShowEMAs)
            {
                Draw.Line(this, "DG_E21_" + CurrentBar, false, 1, ema21[1], 0, ema21[0], Brushes.DeepSkyBlue, DashStyleHelper.Solid, 1);
                Draw.Line(this, "DG_E200_" + CurrentBar, false, 1, ema200[1], 0, ema200[0], Brushes.White, DashStyleHelper.Dot, 1);
            }

            if (ShowSignals && direction != 0 && CurrentBar - lastSignalBar >= SignalCooldownBars)
            {
                if (direction == 1)
                {
                    Draw.ArrowUp(this, "DG_BUY_" + CurrentBar, false, 0, Low[0] - 2 * TickSize, Brushes.LimeGreen);
                    Draw.Text(this, "DG_BUY_TXT_" + CurrentBar, "DG BUY\n" + dominantScore.ToString("0"), 0, Low[0] - 8 * TickSize, Brushes.LimeGreen);
                }
                else
                {
                    Draw.ArrowDown(this, "DG_SELL_" + CurrentBar, false, 0, High[0] + 2 * TickSize, Brushes.Red);
                    Draw.Text(this, "DG_SELL_TXT_" + CurrentBar, "DG SELL\n" + dominantScore.ToString("0"), 0, High[0] + 8 * TickSize, Brushes.Red);
                }
                lastSignalBar = CurrentBar;
            }

            if (ShowPanel)
            {
                string panel =
                    "DEGOLD M15 DIRECTIONAL COMPASS V1" + Environment.NewLine +
                    "ESTADO: " + marketState + " | DECISAO: " + decision + Environment.NewLine +
                    "BUY: " + buyScore.ToString("0.0") + " | SELL: " + sellScore.ToString("0.0") + " | SPREAD: " + spread.ToString("0.0") + Environment.NewLine +
                    "ADX: " + adx[0].ToString("0.0") + " | VWAP: " + sessionVWAP.ToString("0.00") + " | DIST VWAP ATR: " + (Math.Abs(Close[0] - sessionVWAP) / Math.Max(atr[0], TickSize)).ToString("0.00") + Environment.NewLine +
                    "8010: " + pythonState + " | Dealer: " + dealerBias + " | Gamma: " + gammaRegime + " | VIX: " + vixRegime + (vixBlock ? " BLOQUEIO" : "") + Environment.NewLine +
                    "MOTIVO: " + reason + Environment.NewLine +
                    "ERRO 8010: " + lastPythonError;

                Draw.TextFixed(this, "DG_M15_PANEL", panel, TextPosition.TopLeft, Brushes.White, new SimpleFont("Consolas", 12), Brushes.Black, Brushes.DimGray, 80);
            }
        }

        private static bool IsBullText(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            s = s.ToUpperInvariant();
            return s.Contains("BULL") || s.Contains("ALTA") || s.Contains("CALL") || s.Contains("COMPRA") || s.Contains("LONG");
        }

        private static bool IsBearText(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            s = s.ToUpperInvariant();
            return s.Contains("BEAR") || s.Contains("BAIXA") || s.Contains("PUT") || s.Contains("VENDA") || s.Contains("SHORT");
        }

        private static double Clamp(double value, double min, double max)
        {
            return Math.Max(min, Math.Min(max, value));
        }

        private static string ExtractJsonString(string json, string key, string fallback)
        {
            try
            {
                Match m = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
                return m.Success ? m.Groups[1].Value : fallback;
            }
            catch { return fallback; }
        }

        private static double ExtractJsonDouble(string json, string key, double fallback)
        {
            try
            {
                Match m = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)");
                if (!m.Success) return fallback;
                double v;
                return double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out v) ? v : fallback;
            }
            catch { return fallback; }
        }

        private static bool ExtractJsonBool(string json, string key, bool fallback)
        {
            try
            {
                Match m = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*(true|false)", RegexOptions.IgnoreCase);
                if (!m.Success) return fallback;
                return m.Groups[1].Value.Equals("true", StringComparison.OrdinalIgnoreCase);
            }
            catch { return fallback; }
        }

        #region Properties

        [NinjaScriptProperty]
        [Range(1, 100)]
        [Display(Name="FastEma", Order=1, GroupName="01. Médias")]
        public int FastEma { get; set; }

        [NinjaScriptProperty]
        [Range(1, 200)]
        [Display(Name="SlowEma", Order=2, GroupName="01. Médias")]
        public int SlowEma { get; set; }

        [NinjaScriptProperty]
        [Range(1, 300)]
        [Display(Name="MidEma", Order=3, GroupName="01. Médias")]
        public int MidEma { get; set; }

        [NinjaScriptProperty]
        [Range(1, 500)]
        [Display(Name="MacroEma", Order=4, GroupName="01. Médias")]
        public int MacroEma { get; set; }

        [NinjaScriptProperty]
        [Range(2, 200)]
        [Display(Name="VolumeMAPeriod", Order=1, GroupName="02. Fluxo")]
        public int VolumeMAPeriod { get; set; }

        [NinjaScriptProperty]
        [Range(2, 200)]
        [Display(Name="AtrPeriod", Order=2, GroupName="02. Fluxo")]
        public int AtrPeriod { get; set; }

        [NinjaScriptProperty]
        [Range(2, 100)]
        [Display(Name="AdxPeriod", Order=3, GroupName="02. Fluxo")]
        public int AdxPeriod { get; set; }

        [NinjaScriptProperty]
        [Range(5, 200)]
        [Display(Name="StructureLookback", Order=1, GroupName="03. Estrutura")]
        public int StructureLookback { get; set; }

        [NinjaScriptProperty]
        [Range(5, 100)]
        [Display(Name="CompressionLookback", Order=2, GroupName="03. Estrutura")]
        public int CompressionLookback { get; set; }

        [NinjaScriptProperty]
        [Range(40, 100)]
        [Display(Name="MinDirectionalScore", Order=1, GroupName="04. Score")]
        public double MinDirectionalScore { get; set; }

        [NinjaScriptProperty]
        [Range(50, 100)]
        [Display(Name="UltraScore", Order=2, GroupName="04. Score")]
        public double UltraScore { get; set; }

        [NinjaScriptProperty]
        [Range(1, 50)]
        [Display(Name="MinScoreSpread", Order=3, GroupName="04. Score")]
        public double MinScoreSpread { get; set; }

        [NinjaScriptProperty]
        [Range(1, 60)]
        [Display(Name="MinAdxTrend", Order=4, GroupName="04. Score")]
        public double MinAdxTrend { get; set; }

        [NinjaScriptProperty]
        [Range(1, 80)]
        [Display(Name="StrongAdxTrend", Order=5, GroupName="04. Score")]
        public double StrongAdxTrend { get; set; }

        [NinjaScriptProperty]
        [Range(0.1, 0.95)]
        [Display(Name="MinBodyRatio", Order=6, GroupName="04. Score")]
        public double MinBodyRatio { get; set; }

        [NinjaScriptProperty]
        [Range(0.5, 5.0)]
        [Display(Name="VolumeImpulseMult", Order=7, GroupName="04. Score")]
        public double VolumeImpulseMult { get; set; }

        [NinjaScriptProperty]
        [Range(1, 20)]
        [Display(Name="VwapSlopeLookback", Order=8, GroupName="04. Score")]
        public int VwapSlopeLookback { get; set; }

        [NinjaScriptProperty]
        [Range(0.3, 5.0)]
        [Display(Name="MaxDistanceFromVWAPAtr", Order=9, GroupName="04. Score")]
        public double MaxDistanceFromVWAPAtr { get; set; }

        [NinjaScriptProperty]
        [Display(Name="UsePython8010", Order=1, GroupName="05. Python 8010")]
        public bool UsePython8010 { get; set; }

        [NinjaScriptProperty]
        [Display(Name="PythonUrl", Order=2, GroupName="05. Python 8010")]
        public string PythonUrl { get; set; }

        [NinjaScriptProperty]
        [Range(1, 50)]
        [Display(Name="PythonRefreshBars", Order=3, GroupName="05. Python 8010")]
        public int PythonRefreshBars { get; set; }

        [NinjaScriptProperty]
        [Range(0.0, 0.35)]
        [Display(Name="PythonContextWeight", Order=4, GroupName="05. Python 8010")]
        public double PythonContextWeight { get; set; }

        [NinjaScriptProperty]
        [Display(Name="TreatPythonAsContextOnly", Order=5, GroupName="05. Python 8010")]
        public bool TreatPythonAsContextOnly { get; set; }

        [NinjaScriptProperty]
        [Display(Name="BlockOnVixBlock", Order=6, GroupName="05. Python 8010")]
        public bool BlockOnVixBlock { get; set; }

        [NinjaScriptProperty]
        [Display(Name="PaintBars", Order=1, GroupName="06. Visual")]
        public bool PaintBars { get; set; }

        [NinjaScriptProperty]
        [Display(Name="ShowPanel", Order=2, GroupName="06. Visual")]
        public bool ShowPanel { get; set; }

        [NinjaScriptProperty]
        [Display(Name="ShowSignals", Order=3, GroupName="06. Visual")]
        public bool ShowSignals { get; set; }

        [NinjaScriptProperty]
        [Display(Name="ShowVWAP", Order=4, GroupName="06. Visual")]
        public bool ShowVWAP { get; set; }

        [NinjaScriptProperty]
        [Display(Name="ShowEMAs", Order=5, GroupName="06. Visual")]
        public bool ShowEMAs { get; set; }

        [NinjaScriptProperty]
        [Range(0, 20)]
        [Display(Name="SignalCooldownBars", Order=6, GroupName="06. Visual")]
        public int SignalCooldownBars { get; set; }

        #endregion
    }
}
