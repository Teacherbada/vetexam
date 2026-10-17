import {headers} from 'next/headers';
import {Suspense} from 'react';
import Home from './Home';
import {initialHomeCoach} from '@/lib/home-coach-server';
import LoadingScreen from '@/components/ui/LoadingScreen';

// Resolve the optional, private card before rendering; the original homepage
// stays intact and accounts without coach get no placeholder or extra spacing.
export const dynamic='force-dynamic';
async function HomePage(){
  return <Home initialCoach={await initialHomeCoach(new Headers(await headers()))} />;
}
// Page-local boundary: other routes do not inherit a fullscreen home loader.
export default function Page(){
  return <Suspense fallback={<LoadingScreen />}><HomePage /></Suspense>;
}
