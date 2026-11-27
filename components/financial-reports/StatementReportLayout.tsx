import type {ReactNode} from 'react';
import type {StatementView} from '../../lib/financial-statement-source';

const layouts: Record<StatementView,string> = {
  income: 'fs-statement-layout',
  position: 'fs-statement-layout fs-position-layout',
  'cash-flow': 'fs-cash-layout fs-source-cash-layout',
};

export default function StatementReportLayout({view,children}:{view:StatementView;children:ReactNode}) {
  return <div className={layouts[view]}>{children}</div>;
}
