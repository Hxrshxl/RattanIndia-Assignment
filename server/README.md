# Revolt Voice Chat Server

Real-time voice chat server using Google's Gemini Live API for Revolt Motors.

## Features

- **Real-time Voice Chat**: Bidirectional audio communication with Gemini Live API
- **Server-to-Server Architecture**: Secure API key handling on backend
- **Interruption Support**: Users can interrupt AI responses naturally
- **Revolt Motors Context**: AI assistant specifically trained for Revolt Motors
- **Connection Management**: Automatic cleanup and health monitoring
- **Low Latency**: Optimized for 1-2 second response times

## Setup

1. **Install Dependencies**:
   ```bash
   cd server
   npm install
   ```

2. **Get Gemini API Key**:
   - Visit [AI Studio](https://aistudio.google.com/app/apikey)
   - Create a new API key
   - Copy the key for the next step

3. **Configure Environment**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your API key:
   ```
   GEMINI_API_KEY=your_actual_api_key_here
   # Alternatively supported env var names (fallbacks):
   # GOOGLE_API_KEY=your_actual_api_key_here
   # API_KEY=your_actual_api_key_here
   
   GEMINI_MODEL=gemini-2.0-flash-live-001
   ```

4. **Start Development Server**:
   ```bash
   npm run dev
   ```

## API Endpoints

- `GET /health` - Server health and connection status
- `GET /stats` - Real-time connection statistics  
- `WS /voice` - WebSocket endpoint for voice communication

## Gemini Models

For production, use:
- `gemini-2.5-flash-preview-native-audio-dialog` (recommended)

For development/testing:
- `gemini-2.0-flash-live-001` (higher rate limits)
- `gemini-live-2.5-flash-preview` (alternative)

## Architecture

```
Client (Frontend) <--WebSocket--> Express Server <--WebSocket--> Gemini Live API
```

### Message Flow

1. **Client Audio** → Server → Gemini Live API
2. **Gemini Response** → Server → Client Audio
3. **Interruptions** handled automatically by Gemini Live API
4. **Connection Management** handled by Express server

## System Instructions

The AI assistant (Rev) is configured with:
- Revolt Motors company knowledge
- Electric vehicle expertise
- Friendly, conversational personality
- Focus on sustainability and innovation

## Troubleshooting

### Common Issues

1. **Connection Failed**: Check API key and internet connection
2. **High Latency**: Switch to development model for testing
3. **Rate Limits**: Use `gemini-2.0-flash-live-001` for development

### Debug Mode

Set `NODE_ENV=development` for detailed error messages.

## Production Deployment

1. Set `NODE_ENV=production`
2. Configure `FRONTEND_URL` for CORS
3. Use `gemini-2.5-flash-preview-native-audio-dialog` model
4. Implement proper logging and monitoring
5. Set up SSL/TLS certificates for WSS connections