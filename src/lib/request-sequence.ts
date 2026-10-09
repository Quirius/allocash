export interface RequestSequence {
  begin(): number;
  invalidate(): void;
  isCurrent(request: number): boolean;
}

export function createRequestSequence(): RequestSequence {
  let current = 0;
  return {
    begin: () => ++current,
    invalidate: () => { current += 1; },
    isCurrent: (request) => request === current,
  };
}
