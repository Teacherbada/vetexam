import { notesHttp } from '@/lib/notes-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return notesHttp(request, (await context.params).id); }
export async function PUT(request: Request, context: Context) { return notesHttp(request, (await context.params).id); }
export async function PATCH(request: Request, context: Context) { return notesHttp(request, (await context.params).id); }
export async function DELETE(request: Request, context: Context) { return notesHttp(request, (await context.params).id); }
