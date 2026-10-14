/**
 * 🤖 WISE Робот — full page of the assistant (the same chat as the side panel). Office roles only; the firm and year
 * are the selected ones. Tools are read-only; drafts need „✓ Потврди“.
 */
import { officePage } from '@/lib/office';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RobotChat } from '@/components/robot/robot-chat';
import { robotPoll } from './actions';

export default async function RobotPage() {
  const { firm } = await officePage('robot');
  if (!firm) return <NoFirm t="🤖 WISE Робот" />;
  const initial = await robotPoll();
  return (
    <>
      <Hd t="🤖 WISE Робот" sub={firm.name} exp={false} />
      <div className="card"><RobotChat initial={initial} full /></div>
    </>
  );
}
