/** Client instrumentation: browser errors go to the error register (`/greski`). */
import { installErrorListeners } from './lib/report-error';

try { installErrorListeners(); } catch { /* monitoring must never break the app */ }
