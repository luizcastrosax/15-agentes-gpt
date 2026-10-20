/**
 * Coeficiente binomial exato em bigint (§7.2).
 *
 * Domínio: para inteiros n >= 0, C(n,r) = 0 se r < 0 ou r > n.
 * Caso contrário usa a recorrência multiplicativa com divisão inteira EXATA:
 *   r <- min(r, n-r);  result <- 1;  para i=1..r: result = result*(n-r+i)/i
 * A divisão é exata a cada passo porque, após i iterações,
 *   result = C(n-r+i, i), que é inteiro.
 */
export function binomial(n: bigint, r: bigint): bigint {
  if (n < 0n) {
    throw new RangeError(`binomial: n deve ser >= 0 (recebido ${n})`);
  }
  if (r < 0n || r > n) return 0n;
  let k = r < n - r ? r : n - r;
  let result = 1n;
  for (let i = 1n; i <= k; i++) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

/** Conveniência para argumentos number pequenos; valida o domínio inteiro. */
export function binomialN(n: number, r: number): bigint {
  if (!Number.isInteger(n) || !Number.isInteger(r)) {
    throw new RangeError('binomialN: argumentos devem ser inteiros');
  }
  return binomial(BigInt(n), BigInt(r));
}
