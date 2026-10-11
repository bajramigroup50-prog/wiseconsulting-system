/** QR code as inline SVG (server component; legacy `qrImg`). */
import QRCode from 'qrcode';

export async function Qr({ text, size = '24mm' }: { text: string; size?: string }) {
  const svg = await QRCode.toString(text || ' ', { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  return <span style={{ display: 'inline-block', width: size, height: size, lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', `<svg width="100%" height="100%" `) }} />;
}
