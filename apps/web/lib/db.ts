import 'server-only';
import { getDb } from '@wise/db';

export const db = () => getDb();
