-- The firms imported from Excel have their manager only as the contact person (`settings.contact`), often in the old
-- program's 7-bit letters ([ ] ^ \ @ { } ~ | ` for Š Ć Č Đ Ž š ć č đ ž). The notes of the annual accounts, the forms and the
-- contracts print the signer (`settings.signer`, „Одговорно лице“) – it was empty („____“). The contact person with a
-- person's name (no digits, not an e-mail) becomes the signer, both with the letters fixed.
UPDATE "firms" f SET "settings" = f."settings"
  || jsonb_build_object('contact', x.c, 'signer', x.c, 'signerRole', coalesce(nullif(f."settings"->>'signerRole', ''), 'Управител'))
FROM (
  SELECT id, CASE WHEN settings->>'contact' ~ '[ŠĆČĐŽšćčđž]' THEN btrim(settings->>'contact')
    ELSE translate(btrim(settings->>'contact'), '[]^\@{}~|`', 'ŠĆČĐŽšćčđž') END AS c
  FROM "firms"
  WHERE coalesce(settings->>'signer', '') = ''
    AND coalesce(btrim(settings->>'contact'), '') <> ''
    AND settings->>'contact' !~ '[0-9]'
    AND settings->>'contact' !~ '@[^ ]+\.'
    AND btrim(settings->>'contact') ~ '^[^ ]+( +[^ ]+){1,3}$'
) x
WHERE f.id = x.id;
