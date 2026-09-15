import Link from 'next/link';

export default async function GovernancePage(){
 return <main className="container"><div className="topbar"><div><h1>Sharia Governance</h1><p className="muted">Rules, methodology versions and review workflow.</p></div><Link className="btn" href="/ar/dashboard">Dashboard</Link></div><section className="card"><h2>Governance principles</h2><ul><li>Every methodology is versioned.</li><li>Rules can remain pending until reviewed.</li><li>Review decisions are auditable and immutable in history.</li><li>The platform does not present one fiqh opinion as universally binding.</li></ul></section><section className="grid"><div className="card"><h3>Methods</h3><p>Independent Lots, Unified Hawl and future custom rulesets.</p></div><div className="card"><h3>Review states</h3><p>Pending → Approved / Rejected / Changes Requested.</p></div><div className="card"><h3>Sources</h3><p>Attach scholar, reference and supporting notes to every rule.</p></div></section></main>;
}
