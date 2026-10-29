'use client';
import {useRef, useState, type TouchEvent} from 'react';
const entries = [
  {
    ar: {title: 'رؤية أوضح للسيولة', description: 'تابع النقد المتاح والاستحقاقات القادمة، ثم افتح العملية المرتبطة من مصدرها.', category: 'السيولة والتدفقات'},
    en: {title: 'A clearer cash position', description: 'Track available cash and upcoming payments, then open the related transaction at its source.', category: 'Cash & liquidity'},
  },
  {
    ar: {title: 'موازنة تدعم القرار', description: 'راجع الموازنة والفعلي والتوقعات قبل إعادة توزيع الموارد.', category: 'التخطيط المالي'},
    en: {title: 'Budgets for decisions', description: 'Compare budgets, actual results and forecasts before reallocating resources.', category: 'Financial planning'},
  },
  {
    ar: {title: 'أصول وزكاة مترابطة', description: 'تابع تكلفة الأصل وقيمته والحول والاحتساب والدفعات في مسار واضح.', category: 'الأصول والزكاة'},
    en: {title: 'Connected assets & zakat', description: 'Follow asset costs, valuations, holding periods, zakat calculations and payments in one clear workflow.', category: 'Assets & zakat'},
  },
  {
    ar: {title: 'ذمم قابلة للمتابعة', description: 'راجع الأقساط والسداد والمتبقي، وانتقل إلى السند الأصلي.', category: 'الذمم والتمويل'},
    en: {title: 'Trackable balances', description: 'Review installments, payments and outstanding balances, then open the original voucher.', category: 'Balances & financing'},
  },
];

export default function YaqeenUseCases({ar}: {ar: boolean}) {
  const [start, setStart] = useState(0);
  const touchStart = useRef<{x: number; y: number} | null>(null);
  function finishSwipe(event: TouchEvent<HTMLDivElement>) {
    const origin = touchStart.current;
    touchStart.current = null;
    const end = event.changedTouches[0];
    if (!origin || !end || event.touches.length) return;
    const dx = end.clientX - origin.x, dy = end.clientY - origin.y;
    if (Math.abs(dx) < 45 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
    const step = (ar ? dx > 0 : dx < 0) ? 1 : -1;
    setStart(current => (current + step + entries.length) % entries.length);
  }
  return <div className="yq-stories">
    <button aria-label={ar ? 'السابق' : 'Previous'} onClick={() => setStart(current => (current + entries.length - 1) % entries.length)}>‹</button>
    <div style={{touchAction: 'pan-y pinch-zoom'}} onTouchStart={event => {
      const point = event.touches[0];
      touchStart.current = event.touches.length === 1 && point ? {x: point.clientX, y: point.clientY} : null;
    }} onTouchMove={event => { if (event.touches.length !== 1) touchStart.current = null; }} onTouchEnd={finishSwipe} onTouchCancel={() => { touchStart.current = null; }}>{[0, 1, 2].map(i => {
      const entry = entries[(i + start) % entries.length][ar ? 'ar' : 'en'];
      return <article key={entries[(i + start) % entries.length].ar.title}>
        <span aria-hidden="true">✦</span>
        <h3>{entry.title}</h3>
        <p>{entry.description}</p>
        <b>{entry.category}</b>
        <small>{ar ? 'مثال على استخدام المنصة' : 'Illustrative platform use case'}</small>
      </article>;
    })}</div>
    <button aria-label={ar ? 'التالي' : 'Next'} onClick={() => setStart(current => (current + 1) % entries.length)}>›</button>
  </div>;
}
