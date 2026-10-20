import type { ExactFractionJSON } from '@lqu/contracts';

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/**
 * Fração exata com numerador/denominador inteiros, normalizada (§6).
 * Sinal sempre no numerador; denominador > 0; gcd reduzido.
 * Imutável.
 */
export class Fraction {
  readonly num: bigint;
  readonly den: bigint;

  constructor(num: bigint, den: bigint) {
    if (den === 0n) throw new RangeError('Fraction: denominador zero');
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = gcd(num, den) || 1n;
    this.num = num / g;
    this.den = den / g;
  }

  static readonly ZERO = new Fraction(0n, 1n);
  static readonly ONE = new Fraction(1n, 1n);

  static fromBigint(n: bigint): Fraction {
    return new Fraction(n, 1n);
  }

  add(o: Fraction): Fraction {
    return new Fraction(this.num * o.den + o.num * this.den, this.den * o.den);
  }

  sub(o: Fraction): Fraction {
    return new Fraction(this.num * o.den - o.num * this.den, this.den * o.den);
  }

  mul(o: Fraction): Fraction {
    return new Fraction(this.num * o.num, this.den * o.den);
  }

  div(o: Fraction): Fraction {
    if (o.num === 0n) throw new RangeError('Fraction: divisão por zero');
    return new Fraction(this.num * o.den, this.den * o.num);
  }

  equals(o: Fraction): boolean {
    return this.num === o.num && this.den === o.den;
  }

  isZero(): boolean {
    return this.num === 0n;
  }

  isOne(): boolean {
    return this.num === 1n && this.den === 1n;
  }

  /** Comparação exata: -1, 0, 1. */
  cmp(o: Fraction): number {
    const lhs = this.num * o.den;
    const rhs = o.num * this.den;
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  }

  /** Aproximação decimal (apenas apresentação; nunca contabilidade). */
  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }

  toJSON(): ExactFractionJSON {
    return {
      numerator: this.num.toString(),
      denominator: this.den.toString(),
      approx: this.toNumber(),
    };
  }

  toString(): string {
    return `${this.num}/${this.den}`;
  }
}
