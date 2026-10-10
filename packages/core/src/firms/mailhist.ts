/** Legacy `mhKind` (13415): kind of a sent message from its subject. */
export function mhKind(s: string | null | undefined): string {
  const t = String(s ?? '');
  return /опомена/i.test(t) ? 'Опомена'
    : /Потврда за уплата/i.test(t) ? 'Потврда за уплата'
      : /Наплата по извод/i.test(t) ? 'Преглед на наплата'
        : /фактура|faktur/i.test(t) ? 'Фактура'
          : /плат/i.test(t) ? 'Плата'
            : /нарачк/i.test(t) ? 'Нарачка'
              : /Испорачано/i.test(t) ? 'Испорака'
                : /Известувања|🔔/.test(t) ? 'Известување' : 'Е-пошта';
}

/** Kind group used by the filter (legacy strips "(последна)" / " 1." suffixes). */
export const mhKindGroup = (k: string) => k.replace(/ \(.*|\s\d\.$/, '');
