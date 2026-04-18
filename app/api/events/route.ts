import {NextRequest, NextResponse} from "next/server";
import { v2 as cloudinary } from 'cloudinary';

import connectDB from "@/lib/mongodb";
import Event from '@/database/event.model';

cloudinary.config(process.env.CLOUDINARY_URL);

export async function POST(req: NextRequest) {
    try {
        await connectDB();

        const contentType = req.headers.get('content-type') || '';
        console.log('Detected Content-Type:', contentType);
        
        let eventData: any = {};
        let tags: string[] = [];
        let agenda: string[] = [];
        let imageUrl: string = '';

        if (contentType.toLowerCase().includes('application/json') || contentType.toLowerCase().includes('text/plain')) {
            try {
                const body = await req.json();
                eventData = body;
                tags = body.tags || [];
                agenda = body.agenda || [];
                imageUrl = body.image || '';
            } catch (e) {
                if (contentType.toLowerCase().includes('text/plain')) {
                     return NextResponse.json({
                        message: 'Event Creation Failed',
                        error: 'Content-Type was "text/plain" and body is not valid JSON. Please change Body type to JSON in your client (e.g. Postman).'
                    }, { status: 400 });
                }
                throw e;
            }
            
            // Delete image from eventData to avoid over-writing with URL if it's supposed to be handled separately
            // although here we spread ...eventData and then override image: imageUrl.
        } else if (contentType.toLowerCase().includes('multipart/form-data')) {
            const formData = await req.formData();
            eventData = Object.fromEntries(formData.entries());
            
            const file = formData.get('image') as File;
            if (!file) return NextResponse.json({ message: 'Image file is required in form-data' }, { status: 400 });

            try {
                const tagsInput = formData.get('tags');
                if (tagsInput) {
                    tags = JSON.parse(tagsInput as string);
                }
                
                const agendaInput = formData.get('agenda');
                if (agendaInput) {
                    agenda = JSON.parse(agendaInput as string);
                }
            } catch (e) {
                return NextResponse.json({ message: 'Invalid format for tags or agenda. Must be a JSON string (e.g. ["tag1", "tag2"])' }, { status: 400 });
            }

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const uploadResult = await new Promise((resolve, reject) => {
                cloudinary.uploader.upload_stream({ resource_type: 'image', folder: 'DevEvent' }, (error, results) => {
                    if (error) return reject(error);
                    resolve(results);
                }).end(buffer);
            });

            imageUrl = (uploadResult as { secure_url: string }).secure_url;
        } else {
            return NextResponse.json({
                message: 'Event Creation Failed',
                error: `Content-Type must be application/json or multipart/form-data. Received: "${contentType}"`
            }, { status: 400 });
        }

        if (!imageUrl) {
            return NextResponse.json({ message: 'Image is required' }, { status: 400 });
        }

        let mode = 'online';
        if (eventData.mode) {
            const inputMode = eventData.mode.toLowerCase();
            if (inputMode.includes('hybrid')) mode = 'hybrid';
            else if (inputMode.includes('online')) mode = 'online';
            else if (inputMode.includes('offline') || inputMode.includes('in-person')) mode = 'offline';
        }

        const createdEvent = await Event.create({
            ...eventData,
            image: imageUrl,
            tags: tags,
            agenda: agenda,
            mode: mode
        });

        return NextResponse.json({ message: 'Event created successfully', event: createdEvent }, { status: 201 });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ message: 'Event Creation Failed', error: e instanceof Error ? e.message : 'Unknown'}, { status: 500 })
    }
}

export async function GET() {
    try {
        await connectDB();

        const events = await Event.find().sort({ createdAt: -1 });

        return NextResponse.json({ message: 'Events fetched successfully', events }, { status: 200 });
    } catch (e) {
        return NextResponse.json({ message: 'Event fetching failed', error: e }, { status: 500 });
    }
}
