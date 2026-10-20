/**
 * Geração aleatória (§8).
 *
 * math-core NÃO acessa rede, ambiente nem fontes de entropia do sistema.
 * A fonte de aleatoriedade é INJETADA via interface RNG. Para experimentos
 * reprodutíveis, use um gerador determinístico versionado (SplitMix64).
 * A fonte do sistema (crypto) deve ser fornecida por uma camada superior.
 */
export interface RNG {
  /** 32 bits aleatórios como inteiro não-assinado [0, 2^32). */
  nextUint32(): number;
  /** Identificador de versão do gerador (para manifesto de reprodução, §20). */
  readonly version: string;
}

/**
 * Inteiro uniforme em [0, L) por rejeição, SEM viés de módulo (§8).
 * Trata L = 1 separadamente. Para L > 1, amostra o número mínimo de bits
 * que representa L-1 e rejeita candidatos >= L.
 */
export function boundedUniform(rng: RNG, L: bigint): bigint {
  if (L <= 0n) throw new RangeError('boundedUniform: L deve ser > 0');
  if (L === 1n) return 0n;
  const bits = (L - 1n).toString(2).length;
  const mask = (1n << BigInt(bits)) - 1n;
  for (;;) {
    let x = 0n;
    let got = 0;
    while (got < bits) {
      x = (x << 32n) | BigInt(rng.nextUint32() >>> 0);
      got += 32;
    }
    x &= mask;
    if (x < L) return x;
  }
}

/**
 * SplitMix64 — gerador determinístico versionado para experimentos (§8, §20).
 * NÃO é um contrato criptográfico. Usado apenas quando a reprodução exige
 * semente e versão explícitas. Não alega independência estatística por hash.
 */
export class SplitMix64 implements RNG {
  readonly version = 'splitmix64-v1';
  private state: bigint;
  private buf = 0n;
  private bufBits = 0;

  constructor(seed: bigint) {
    this.state = BigInt.asUintN(64, seed);
  }

  private next64(): bigint {
    this.state = BigInt.asUintN(64, this.state + 0x9e3779b97f4a7c15n);
    let z = this.state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    z = z ^ (z >> 31n);
    return BigInt.asUintN(64, z);
  }

  nextUint32(): number {
    if (this.bufBits < 32) {
      this.buf = this.next64();
      this.bufBits = 64;
    }
    const out = Number(this.buf & 0xffffffffn);
    this.buf >>= 32n;
    this.bufBits -= 32;
    return out >>> 0;
  }
}
