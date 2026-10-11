/** Legacy `FUEL_RX` / `isFuel` / `fuelSeller` (14356–14365): a firm sells fuel when an item or a recent invoice line names a fuel. */
export const FUEL_RX = /(еуро\s*дизел|евродизел|дизел|бензин|безоловн|eurodiesel|euro\s*diesel|diesel|dizel|benzin|bezolovn|нафта|lpg|лпг|автогас|autogas|пропан|мазут|кероз|гориво|goriv|bmb\s*9|ед\s*-?\s*1|ulsd)/i;

export const isFuel = (name: unknown): boolean => FUEL_RX.test(String(name ?? ''));

/** The same pattern for PostgreSQL `~*` (ARE understands `\s`). */
export const FUEL_PG = FUEL_RX.source;

/** Legacy `fpShort`: firm name without the legal form, for buttons. */
export const firmShort = (name: string): string =>
  String(name || '').replace(/\s+(ДООЕЛ|ДОО|АД|ТП|DOOEL|DOO|AD)(?=\s|$).*$/i, '').replace(/^(Друштво за [^\s]+( и [^\s]+)? )/i, '').trim() || name;
