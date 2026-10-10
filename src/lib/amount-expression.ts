const MAX = 9_223_372_036_854_775_807n;
const MIN = -9_223_372_036_854_775_808n;
const MAX_EXPRESSION_LENGTH = 256;
const MAX_INTERMEDIATE_DIGITS = 512;

type Rational = { numerator: bigint; denominator: bigint };

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new Error("Division by zero.");
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const divisor = gcd(numerator, denominator);
  const result = { numerator: numerator / divisor, denominator: denominator / divisor };
  if (result.numerator.toString().length > MAX_INTERMEDIATE_DIGITS || result.denominator.toString().length > MAX_INTERMEDIATE_DIGITS) {
    throw new Error("The amount expression is too large.");
  }
  return result;
}

/** Parse an integer HUF literal or arithmetic expression without evaluating JavaScript. */
export function parseAmountExpression(value: string): bigint {
  if (value.length > MAX_EXPRESSION_LENGTH) throw new Error("The amount expression is too long.");
  let source = value.trim();
  if (/ft$/i.test(source)) source = source.slice(0, -2).trimEnd();
  if (!source) throw new Error("Enter an amount.");
  let cursor = 0;
  const skipSpace = () => { while (source[cursor] === " " || source[cursor] === "\t" || source[cursor] === "\n" || source[cursor] === "\r") cursor++; };
  const peek = () => { skipSpace(); return source[cursor]; };
  const parseSum = (): Rational => {
    let left = parseProduct();
    while (true) {
      const op = peek();
      if (op !== "+" && op !== "-") break;
      cursor++;
      const right = parseProduct();
      left = op === "+"
        ? rational(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator)
        : rational(left.numerator * right.denominator - right.numerator * left.denominator, left.denominator * right.denominator);
    }
    return left;
  };
  const parseProduct = (): Rational => {
    let left = parseUnary();
    while (true) {
      const op = peek();
      if (op !== "*" && op !== "/") break;
      cursor++;
      const right = parseUnary();
      left = op === "*"
        ? rational(left.numerator * right.numerator, left.denominator * right.denominator)
        : rational(left.numerator * right.denominator, left.denominator * right.numerator);
    }
    return left;
  };
  const parseUnary = (): Rational => {
    const op = peek();
    if (op === "+" || op === "-") {
      cursor++;
      const value = parseUnary();
      return op === "-" ? { ...value, numerator: -value.numerator } : value;
    }
    return parseAtom();
  };
  const parseAtom = (): Rational => {
    if (peek() === "(") {
      cursor++;
      const value = parseSum();
      if (peek() !== ")") throw new Error("Unclosed parenthesis.");
      cursor++;
      return value;
    }
    skipSpace();
    const start = cursor;
    if (source[cursor] === undefined || source[cursor]! < "0" || source[cursor]! > "9") throw new Error("Expected an amount.");
    cursor++;
    while (cursor < source.length) {
      if (source[cursor]! >= "0" && source[cursor]! <= "9") { cursor++; continue; }
      if (source[cursor] === " ") {
        let end = cursor;
        while (source[end] === " ") end++;
        let digits = end;
        while (source[digits] !== undefined && source[digits]! >= "0" && source[digits]! <= "9") digits++;
        const groupLength = digits - end;
        const priorGroups = source.slice(start, cursor).split(" ");
        if (groupLength === 3 && (priorGroups.length === 1 ? priorGroups[0]!.length <= 3 : priorGroups.at(-1)!.length === 3)) { cursor = digits; continue; }
      }
      break;
    }
    const text = source.slice(start, cursor);
    const groups = text.split(" ");
    if (groups.some((group, index) => !/^\d+$/.test(group) || (index > 0 && group.length !== 3)) || (groups.length > 1 && groups[0]!.length > 3)) {
      throw new Error("Invalid digit grouping.");
    }
    return rational(BigInt(text.replaceAll(" ", "")));
  };

  const result = parseSum();
  if (peek() !== undefined) throw new Error("Unexpected text in amount expression.");
  if (result.denominator !== 1n) throw new Error("The result must be a whole HUF amount.");
  if (result.numerator < MIN || result.numerator > MAX) throw new Error("The amount exceeds the supported HUF range.");
  return result.numerator;
}
