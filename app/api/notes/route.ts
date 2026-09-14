import { notesHttp } from '@/lib/notes-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return notesHttp(request); }
export async function POST(request: Request) { return notesHttp(request); }
