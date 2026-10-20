import {redirect} from 'next/navigation';
export default async function Page({params}:{params:Promise<{locale:string}>}){redirect('/'+(await params).locale+'/payables?scope=ORGANIZATION')}
