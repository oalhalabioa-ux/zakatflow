import './globals.css';
import './landing.css';
import './yaqeen-brand.css';
export const metadata={title:{default:'يقين الأعمال | YAQEEN BUSINESS',template:'%s | YAQEEN BUSINESS'},description:'منصة الإدارة المالية والأعمال الذكية — Smart Finance & Business Platform'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><body>{children}</body></html>}
