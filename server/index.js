const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const cors = require("cors")
const crypto = require("crypto")
require("dotenv").config()

// Environment configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-live-001"

const app = express()
const server = http.createServer(app)

// Middleware
app.use(
  cors({
    origin: process.env.NODE_ENV === "production" ? process.env.FRONTEND_URL : "http://localhost:3000",
    credentials: true,
  }),
)
app.use(express.json())

// WebSocket server for client connections
const wss = new WebSocket.Server({
  server,
  path: "/voice",
})

// Store active connections and their Gemini sessions
const activeConnections = new Map()

wss.on("connection", (ws, req) => {
  const connectionId = generateConnectionId()
  console.log(`New voice connection: ${connectionId}`)

  // Initialize Gemini Live API connection
  initializeGeminiSession(connectionId, ws)

  ws.on("message", async (data) => {
    try {
      if (data instanceof Buffer) {
        // Handle binary audio data
        await handleAudioInput(connectionId, data)
      } else {
        // Handle text messages
        const message = JSON.parse(data.toString())
        await handleClientMessage(connectionId, message)
      }
    } catch (error) {
      console.error("Error processing message:", error)
      ws.send(JSON.stringify({ type: "error", message: "Failed to process message" }))
    }
  })

  ws.on("close", () => {
    console.log(`Connection closed: ${connectionId}`)
    cleanupConnection(connectionId)
  })

  ws.on("error", (error) => {
    console.error(`WebSocket error for ${connectionId}:`, error)
    cleanupConnection(connectionId)
  })
})

// Initialize Gemini Live API session
async function initializeGeminiSession(connectionId, clientWs) {
  try {
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not configured. Set it in server/.env. See server/.env.example")
      if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: "error",
            message: "Server is missing Gemini API key. Ask the administrator to set GEMINI_API_KEY.",
          }),
        )
      }
      return
    }

    const geminiWs = new WebSocket(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService/BidiGenerateContent",
      {
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
        },
      },
    )

    // Store connection data
    activeConnections.set(connectionId, {
      clientWs,
      geminiWs,
      connected: false,
      lastActivity: Date.now(),
      isGenerating: false,
    })

    geminiWs.on("open", () => {
      console.log(`Gemini session opened for ${connectionId}`)

      // Send initial setup configuration
      const setupMessage = {
        setup: {
          model: `models/${GEMINI_MODEL}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Aoede",
                },
              },
            },
          },
          systemInstruction: {
            parts: [
              {
                text: `You are Rev, the AI assistant for Revolt Motors, an innovative electric vehicle company. 
                
Key information about Revolt Motors:
- Leading manufacturer of electric motorcycles and scooters
- Founded with a mission to revolutionize urban mobility
- Known for high-performance, eco-friendly electric vehicles
- Offers smart connectivity features and IoT integration
- Focuses on sustainable transportation solutions

Your personality:
- Friendly, knowledgeable, and enthusiastic about electric vehicles
- Speak naturally and conversationally
- Keep responses concise but informative
- Show passion for sustainable transportation and innovation

Guidelines:
- Always stay in character as Rev from Revolt Motors
- Provide helpful information about electric vehicles, sustainability, and Revolt Motors
- If asked about competitors, be respectful but highlight Revolt's unique advantages
- For technical questions outside your expertise, acknowledge limitations
- Encourage interest in electric mobility and environmental consciousness

Remember: You're having a voice conversation, so speak naturally and avoid overly formal language.`,
              },
            ],
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
              endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
              prefixPaddingMs: 300,
              silenceDurationMs: 1000,
            },
            activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
          },
        },
      }

      geminiWs.send(JSON.stringify(setupMessage))
    })

    geminiWs.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString())
        handleGeminiMessage(connectionId, message)
      } catch (error) {
        console.error("Error parsing Gemini message:", error)
      }
    })

    geminiWs.on("close", () => {
      console.log(`Gemini session closed for ${connectionId}`)
      const connection = activeConnections.get(connectionId)
      if (connection && connection.clientWs.readyState === WebSocket.OPEN) {
        connection.clientWs.send(
          JSON.stringify({
            type: "connection",
            status: "disconnected",
            message: "Gemini session ended",
          }),
        )
      }
    })

    geminiWs.on("error", (error) => {
      console.error(`Gemini WebSocket error for ${connectionId}:`, error)
      const connection = activeConnections.get(connectionId)
      if (connection && connection.clientWs.readyState === WebSocket.OPEN) {
        connection.clientWs.send(
          JSON.stringify({
            type: "error",
            message: "Gemini connection failed",
          }),
        )
      }
    })
  } catch (error) {
    console.error("Failed to initialize Gemini session:", error)
    clientWs.send(
      JSON.stringify({
        type: "error",
        message: "Failed to connect to Gemini Live API",
      }),
    )
  }
}

// Handle messages from Gemini Live API
function handleGeminiMessage(connectionId, message) {
  const connection = activeConnections.get(connectionId)
  if (!connection || connection.clientWs.readyState !== WebSocket.OPEN) return

  if (message.setupComplete) {
    console.log(`Gemini setup complete for ${connectionId}`)
    connection.connected = true
    connection.clientWs.send(
      JSON.stringify({
        type: "connection",
        status: "connected",
        connectionId,
      }),
    )
  }

  if (message.serverContent) {
    const content = message.serverContent

    // Handle audio response
    if (content.modelTurn && content.modelTurn.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.inlineData && part.inlineData.mimeType.startsWith("audio/")) {
          // Send audio data to client
          const audioBuffer = Buffer.from(part.inlineData.data, "base64")
          connection.clientWs.send(audioBuffer)
        }
      }
    }

    // Handle generation status
    if (content.generationComplete) {
      connection.isGenerating = false
      connection.clientWs.send(
        JSON.stringify({
          type: "generation_complete",
        }),
      )
    }

    if (content.interrupted) {
      connection.isGenerating = false
      connection.clientWs.send(
        JSON.stringify({
          type: "interrupted",
        }),
      )
    }

    if (content.turnComplete) {
      connection.isGenerating = false
      connection.clientWs.send(
        JSON.stringify({
          type: "turn_complete",
        }),
      )
    }
  }
}

// Handle audio input from client
async function handleAudioInput(connectionId, audioData) {
  const connection = activeConnections.get(connectionId)
  if (!connection || !connection.connected || connection.geminiWs.readyState !== WebSocket.OPEN) {
    return
  }

  // Update last activity
  connection.lastActivity = Date.now()

  // Send audio to Gemini Live API
  const realtimeInput = {
    realtimeInput: {
      audio: {
        mimeType: "audio/pcm",
        data: audioData.toString("base64"),
      },
    },
  }

  connection.geminiWs.send(JSON.stringify(realtimeInput))
}

// Handle client messages (non-audio)
async function handleClientMessage(connectionId, message) {
  const connection = activeConnections.get(connectionId)
  if (!connection) return

  switch (message.type) {
    case "ping":
      connection.clientWs.send(JSON.stringify({ type: "pong" }))
      break

    case "interrupt":
      // Send interruption signal to Gemini
      if (connection.geminiWs.readyState === WebSocket.OPEN) {
        const interruptMessage = {
          realtimeInput: {
            activityStart: {},
          },
        }
        connection.geminiWs.send(JSON.stringify(interruptMessage))
      }
      break

    case "audio_stream_end":
      // Signal end of audio stream
      if (connection.geminiWs.readyState === WebSocket.OPEN) {
        const endMessage = {
          realtimeInput: {
            audioStreamEnd: true,
          },
        }
        connection.geminiWs.send(JSON.stringify(endMessage))
      }
      break

    default:
      console.log("Unknown message type:", message.type)
  }
}

// Cleanup connection
function cleanupConnection(connectionId) {
  const connection = activeConnections.get(connectionId)
  if (connection) {
    if (connection.geminiWs && connection.geminiWs.readyState === WebSocket.OPEN) {
      connection.geminiWs.close()
    }
    activeConnections.delete(connectionId)
  }
}

// Generate unique connection ID
function generateConnectionId() {
  return `conn_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    activeConnections: activeConnections.size,
    uptime: process.uptime(),
    geminiModel: GEMINI_MODEL,
    apiKeyConfigured: Boolean(GEMINI_API_KEY),
  })
})

// Connection stats endpoint
app.get("/stats", (req, res) => {
  const connections = Array.from(activeConnections.entries()).map(([id, conn]) => ({
    id,
    connected: conn.connected,
    isGenerating: conn.isGenerating,
    lastActivity: new Date(conn.lastActivity).toISOString(),
  }))

  res.json({
    totalConnections: activeConnections.size,
    connections,
  })
})

// Cleanup inactive connections
setInterval(() => {
  const now = Date.now()
  const timeout = 5 * 60 * 1000 // 5 minutes

  for (const [connectionId, connection] of activeConnections.entries()) {
    if (now - connection.lastActivity > timeout) {
      console.log(`Cleaning up inactive connection: ${connectionId}`)
      cleanupConnection(connectionId)
    }
  }
}, 60000) // Check every minute

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Server error:", error)
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? error.message : "Something went wrong",
  })
})

// Start server
const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`Revolt Voice Chat Server running on port ${PORT}`)
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/voice`)
  console.log(`Health check: http://localhost:${PORT}/health`)
  console.log(`Gemini Model: ${GEMINI_MODEL}`)
  console.log(`Gemini API Key configured: ${GEMINI_API_KEY ? "yes" : "no"}`)
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully")
  // Close all Gemini connections
  for (const [connectionId, connection] of activeConnections.entries()) {
    cleanupConnection(connectionId)
  }
  server.close(() => {
    console.log("Server closed")
    process.exit(0)
  })
})

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully")
  // Close all Gemini connections
  for (const [connectionId, connection] of activeConnections.entries()) {
    cleanupConnection(connectionId)
  }
  server.close(() => {
    console.log("Server closed")
    process.exit(0)
  })
})
