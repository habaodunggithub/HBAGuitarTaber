import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import Shell from '../../components/Shell';

export const backLink = <Link to="/#lib" className="crumb"><Icon name="back" size={16} /> Tabs</Link>;

/** A full-page message (not found, failed, canceled) with the way back. */
export function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell center={backLink}>
      <main id="content" className="page narrow">
        <div className="message">
          <h1 className="display-sm">{title}</h1>
          {children}
        </div>
      </main>
    </Shell>
  );
}
