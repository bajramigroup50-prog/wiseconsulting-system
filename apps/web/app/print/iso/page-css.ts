/** Paged-media footer of the ISO prints: the office on the left, „ОБР-05 · в.1.0 · стр. 1/2“ on the right. */
export const docPageCss = (mark: string, office: string, landscape = false) =>
  `@page{size:A4${landscape ? ' landscape' : ''};margin:16mm 16mm 18mm;@bottom-left{content:${JSON.stringify(office)};font:8pt Arial;color:#555}@bottom-right{content:${JSON.stringify(`${mark} · стр. `)} counter(page) "/" counter(pages);font:8pt Arial;color:#555}}`;
