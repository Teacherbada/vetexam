import {headers} from 'next/headers';
import Home from './Home';
import {initialHomeCoach} from '@/lib/home-coach-server';

// Resolve the optional, private card before rendering; the original homepage
// stays intact and accounts without coach get no placeholder or extra spacing.
export const dynamic='force-dynamic';
export default async function Page(){
  return <Home initialCoach={await initialHomeCoach(new Headers(await headers()))} />;
}
