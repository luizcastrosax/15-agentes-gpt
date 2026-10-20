/*!
 * lqu-core-web — núcleo matemático verificável (porte do pacote @lqu/math-core).
 * JavaScript puro para navegador (BigInt + crypto). Sem dependências, sem build.
 *
 * Conduz a base de cálculo e geração do gerador:
 *  - binomial exato (BigInt)
 *  - probabilidade hipergeométrica EXATA (fração inteira, soma = 1)
 *  - geração uniforme por rank/unrank colex + inteiro uniforme por rejeição
 *  - verificação CONDICIONAL de fechamento
 *
 * NÃO prevê sorteios. Melhora correção, exatidão e reprodutibilidade — não a chance.
 */
(function (global) {
  'use strict';

  function binomial(n, r) { // n, r: BigInt
    if (n < 0n) throw new RangeError('binomial: n deve ser >= 0');
    if (r < 0n || r > n) return 0n;
    var k = r < n - r ? r : n - r;
    var res = 1n;
    for (var i = 1n; i <= k; i++) res = (res * (n - k + i)) / i;
    return res;
  }

  function gcd(a, b) {
    a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }

  function Fraction(num, den) {
    if (den === 0n) throw new RangeError('Fraction: denominador zero');
    if (den < 0n) { num = -num; den = -den; }
    var g = gcd(num, den) || 1n;
    this.num = num / g; this.den = den / g;
  }
  Fraction.prototype.add = function (o) {
    return new Fraction(this.num * o.den + o.num * this.den, this.den * o.den);
  };
  Fraction.prototype.isOne = function () { return this.num === 1n && this.den === 1n; };
  Fraction.prototype.isZero = function () { return this.num === 0n; };
  Fraction.prototype.toNumber = function () { return Number(this.num) / Number(this.den); };
  /** "1 em N": devroi den/num como número (aprox. só para apresentação). */
  Fraction.prototype.oneInN = function () {
    if (this.num === 0n) return Infinity;
    return Number(this.den) / Number(this.num);
  };
  Fraction.prototype.toString = function () { return this.num + '/' + this.den; };

  /** P(X = r) exato: N universo, k tamanho da aposta, d sorteadas (§7.3). */
  function hyperExact(N, k, d, r) {
    var lo = Math.max(0, k + d - N), hi = Math.min(k, d);
    if (r < lo || r > hi) return new Fraction(0n, 1n);
    var numer = binomial(BigInt(k), BigInt(r)) * binomial(BigInt(N - k), BigInt(d - r));
    var denom = binomial(BigInt(N), BigInt(d));
    return new Fraction(numer, denom);
  }
  function hyperAtLeast(N, k, d, t) {
    var hi = Math.min(k, d), s = new Fraction(0n, 1n);
    for (var r = Math.max(t, 0); r <= hi; r++) s = s.add(hyperExact(N, k, d, r));
    return s;
  }
  function hyperSum(N, k, d) {
    var lo = Math.max(0, k + d - N), hi = Math.min(k, d), s = new Fraction(0n, 1n);
    for (var r = lo; r <= hi; r++) s = s.add(hyperExact(N, k, d, r));
    return s;
  }

  /** rank colex de uma combinação ordenada crescente (§8). */
  function rankColex(combo) {
    var r = 0n;
    for (var j = 0; j < combo.length; j++) r += binomial(BigInt(combo[j] - 1), BigInt(j + 1));
    return r;
  }
  /** unrank colex: combinação de tamanho k em [1,N] cujo rank é `rank`. */
  function unrankColex(rank, k, N) {
    var combo = new Array(k), r = rank;
    for (var j = k; j >= 1; j--) {
      var v = j - 1;
      while (binomial(BigInt(v + 1), BigInt(j)) <= r) v++;
      combo[j - 1] = v + 1;
      r -= binomial(BigInt(v), BigInt(j));
    }
    return combo;
  }

  function cryptoUint32() {
    var c = global.crypto || global.msCrypto;
    var a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] >>> 0;
  }

  /** Inteiro uniforme em [0, L) por rejeição, sem viés de módulo (§8). */
  function boundedUniform(L) {
    if (L <= 0n) throw new RangeError('boundedUniform: L > 0');
    if (L === 1n) return 0n;
    var bits = (L - 1n).toString(2).length;
    var mask = (1n << BigInt(bits)) - 1n;
    for (;;) {
      var x = 0n, got = 0;
      while (got < bits) { x = (x << 32n) | BigInt(cryptoUint32()); got += 32; }
      x &= mask;
      if (x < L) return x;
    }
  }

  /** Subconjunto de k dezenas em [1,N] escolhido UNIFORMEMENTE entre todos os C(N,k). */
  function sampleUniformSubset(N, k) {
    var M = binomial(BigInt(N), BigInt(k));
    return unrankColex(boundedUniform(M), k, N).slice().sort(function (a, b) { return a - b; });
  }

  function popcountBig(x) { var c = 0; while (x > 0n) { x &= x - 1n; c++; } return c; }

  /**
   * Verificação CONDICIONAL de fechamento (§10): enumera TODOS os sorteios D ⊂ S
   * de tamanho d e tabula o melhor nº de acertos. Sem amostragem.
   */
  function verifyClosureConditional(S, bets, d, guaranteed) {
    var Ss = S.slice().sort(function (a, b) { return a - b; });
    var betMasks = bets.map(function (b) {
      var m = 0n; for (var i = 0; i < b.length; i++) m |= 1n << BigInt(b[i] - 1); return m;
    });
    var dist = {}, counter = 0;
    var idx = []; for (var i = 0; i < d; i++) idx.push(i);
    for (;;) {
      var dMask = 0n;
      for (var a = 0; a < d; a++) dMask |= 1n << BigInt(Ss[idx[a]] - 1);
      var best = 0;
      for (var b2 = 0; b2 < betMasks.length; b2++) {
        var h = popcountBig(betMasks[b2] & dMask);
        if (h > best) best = h;
      }
      dist[best] = (dist[best] || 0) + 1;
      if (best < guaranteed) counter++;
      var p = d - 1;
      while (p >= 0 && idx[p] === Ss.length - (d - p)) p--;
      if (p < 0) break;
      idx[p]++;
      for (var q = p + 1; q < d; q++) idx[q] = idx[q - 1] + 1;
    }
    return {
      distribution: dist,
      counterexamples: counter,
      scenarios: Number(binomial(BigInt(Ss.length), BigInt(d))),
      proofStatus: counter === 0 ? 'VERIFIED_CONDITIONAL' : 'NOT_PROVEN',
    };
  }

  /** Autoteste rápido das fixtures do contrato (§21.1). */
  function selfTest() {
    var checks = [];
    checks.push(binomial(25n, 15n) === 3268760n);
    checks.push(binomial(60n, 6n) === 50063860n);
    checks.push(hyperSum(25, 15, 15).isOne());
    checks.push(hyperSum(60, 6, 6).isOne());
    var c = unrankColex(rankColex([3, 8, 14, 20, 25]), 5, 25);
    checks.push(c.join(',') === '3,8,14,20,25');
    var p = hyperExact(60, 6, 6, 6);
    checks.push(p.num === 1n && p.den === 50063860n);
    var passed = checks.every(Boolean);
    return { passed: passed, total: checks.length, failed: checks.filter(function (x) { return !x; }).length };
  }

  global.LQU = {
    version: 'lqu-core-web-v1',
    binomial: binomial,
    Fraction: Fraction,
    hyperExact: hyperExact,
    hyperAtLeast: hyperAtLeast,
    hyperSum: hyperSum,
    rankColex: rankColex,
    unrankColex: unrankColex,
    boundedUniform: boundedUniform,
    sampleUniformSubset: sampleUniformSubset,
    verifyClosureConditional: verifyClosureConditional,
    selfTest: selfTest,
  };
})(typeof window !== 'undefined' ? window : this);
