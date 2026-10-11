/**
 * pdfjs (legacy build) in Node needs `DOMMatrix` at module load; it takes it from the optional `@napi-rs/canvas`,
 * which the Next standalone output does not carry (native package, not traced). Text extraction never renders, so a
 * small affine-matrix stand-in is enough. Call before `import('pdfjs-dist/legacy/build/pdf.mjs')`.
 */
class DOMMatrixLite {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(init?: number[] | string) {
    if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init as [number, number, number, number, number, number];
  }
  get m11() { return this.a; } get m12() { return this.b; } get m21() { return this.c; } get m22() { return this.d; } get m41() { return this.e; } get m42() { return this.f; }
  get is2D() { return true; }
  get isIdentity() { return this.a === 1 && !this.b && !this.c && this.d === 1 && !this.e && !this.f; }
  multiplySelf(o: DOMMatrixLite) {
    const { a, b, c, d, e, f } = this;
    this.a = a * o.a + c * o.b; this.b = b * o.a + d * o.b;
    this.c = a * o.c + c * o.d; this.d = b * o.c + d * o.d;
    this.e = a * o.e + c * o.f + e; this.f = b * o.e + d * o.f + f;
    return this;
  }
  preMultiplySelf(o: DOMMatrixLite) { const m = new DOMMatrixLite([o.a, o.b, o.c, o.d, o.e, o.f]).multiplySelf(this); Object.assign(this, { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }); return this; }
  multiply(o: DOMMatrixLite) { return new DOMMatrixLite([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(o); }
  translateSelf(x = 0, y = 0) { return this.multiplySelf(new DOMMatrixLite([1, 0, 0, 1, x, y])); }
  translate(x = 0, y = 0) { return this.multiply(new DOMMatrixLite([1, 0, 0, 1, x, y])); }
  scaleSelf(x = 1, y = x) { return this.multiplySelf(new DOMMatrixLite([x, 0, 0, y, 0, 0])); }
  scale(x = 1, y = x) { return this.multiply(new DOMMatrixLite([x, 0, 0, y, 0, 0])); }
  invertSelf() {
    const { a, b, c, d, e, f } = this;
    const det = a * d - b * c;
    if (!det) { this.a = this.b = this.c = this.d = this.e = this.f = NaN; return this; }
    this.a = d / det; this.b = -b / det; this.c = -c / det; this.d = a / det;
    this.e = (c * f - d * e) / det; this.f = (b * e - a * f) / det;
    return this;
  }
  inverse() { return new DOMMatrixLite([this.a, this.b, this.c, this.d, this.e, this.f]).invertSelf(); }
  transformPoint(p: { x?: number; y?: number } = {}) { const x = p.x ?? 0, y = p.y ?? 0; return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 }; }
}

/** Define the browser globals pdfjs expects when the native canvas package is missing (text extraction only). */
export function ensurePdfGlobals(): void {
  const G = globalThis as Record<string, unknown>;
  G.DOMMatrix ??= DOMMatrixLite;
  G.ImageData ??= class { data: unknown; width: number; height: number; constructor(data: unknown, width: number, height: number) { this.data = data; this.width = width; this.height = height; } };
  G.Path2D ??= class { addPath() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} rect() {} closePath() {} };
}
