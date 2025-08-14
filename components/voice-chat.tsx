"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Mic, MicOff, Volume2, VolumeX, Activity, Wifi, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"

type ConnectionStatus = "disconnected" | "connecting" | "connected"
type RecordingState = "idle" | "recording" | "processing"

interface PerformanceMetrics {
  latency: number
  audioQuality: number
  connectionStability: number
  responseTime: number
  packetsLost: number
  jitter: number
}

interface AudioLevel {
  input: number
  output: number
}

export default function VoiceChat() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected")
  const [recordingState, setRecordingState] = useState<RecordingState>("idle")
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevels, setAudioLevels] = useState<AudioLevel>({ input: 0, output: 0 })
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics>({
    latency: 0,
    audioQuality: 100,
    connectionStability: 100,
    responseTime: 0,
    packetsLost: 0,
    jitter: 0,
  })
  const [showMetrics, setShowMetrics] = useState(false)

  // Refs for audio processing
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number>()
  const performanceTimerRef = useRef<number>()

  // Performance tracking
  const requestStartTimeRef = useRef<number>(0)
  const connectionStartTimeRef = useRef<number>(0)
  const metricsHistoryRef = useRef<PerformanceMetrics[]>([])

  // Initialize WebSocket connection with performance monitoring
  const connectToServer = useCallback(() => {
    setConnectionStatus("connecting")
    connectionStartTimeRef.current = performance.now()

    const ws = new WebSocket("ws://localhost:3001/voice")
    wsRef.current = ws

    ws.onopen = () => {
      const connectionTime = performance.now() - connectionStartTimeRef.current
      setConnectionStatus("connected")
      updatePerformanceMetrics({ responseTime: connectionTime })
    }

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        // Calculate response latency
        const responseTime = performance.now() - requestStartTimeRef.current
        updatePerformanceMetrics({ latency: responseTime })
        playAudioResponse(event.data)
      } else {
        try {
          const message = JSON.parse(event.data)
          handleServerMessage(message)
        } catch (error) {
          console.error("Error parsing server message:", error)
        }
      }
    }

    ws.onclose = () => {
      setConnectionStatus("disconnected")
      updatePerformanceMetrics({ connectionStability: 0 })
    }

    ws.onerror = () => {
      setConnectionStatus("disconnected")
      updatePerformanceMetrics({ connectionStability: 0, packetsLost: performanceMetrics.packetsLost + 1 })
    }
  }, [performanceMetrics.packetsLost])

  // Handle server messages
  const handleServerMessage = useCallback((message: any) => {
    switch (message.type) {
      case "connection":
        if (message.status === "connected") {
          updatePerformanceMetrics({ connectionStability: 100 })
        }
        break
      case "generation_complete":
        setIsPlaying(false)
        setRecordingState("idle")
        break
      case "interrupted":
        setIsPlaying(false)
        setRecordingState("idle")
        break
      case "turn_complete":
        setRecordingState("idle")
        break
    }
  }, [])

  // Update performance metrics
  const updatePerformanceMetrics = useCallback((updates: Partial<PerformanceMetrics>) => {
    setPerformanceMetrics((prev) => {
      const newMetrics = { ...prev, ...updates }

      // Keep history for trend analysis
      metricsHistoryRef.current.push(newMetrics)
      if (metricsHistoryRef.current.length > 100) {
        metricsHistoryRef.current.shift()
      }

      return newMetrics
    })
  }, [])

  // Optimized audio recording with quality monitoring
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
      })

      // Setup audio analysis for quality monitoring
      const audioContext = new AudioContext({ sampleRate: 48000 })
      const analyser = audioContext.createAnalyser()
      const source = audioContext.createMediaStreamSource(stream)

      analyser.fftSize = 256
      source.connect(analyser)

      audioContextRef.current = audioContext
      analyserRef.current = analyser

      // Start audio level monitoring
      monitorAudioLevels()

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 64000,
      })

      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })
        sendAudioToServer(audioBlob)
        stream.getTracks().forEach((track) => track.stop())

        // Stop audio monitoring
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current)
        }
      }

      // Record in chunks for real-time streaming
      mediaRecorder.start(100) // 100ms chunks for low latency
      setRecordingState("recording")
      requestStartTimeRef.current = performance.now()
    } catch (error) {
      console.error("Error starting recording:", error)
      updatePerformanceMetrics({ audioQuality: 0 })
    }
  }, [])

  // Monitor audio levels for quality assessment
  const monitorAudioLevels = useCallback(() => {
    if (!analyserRef.current) return

    const analyser = analyserRef.current
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const updateLevels = () => {
      analyser.getByteFrequencyData(dataArray)

      // Calculate RMS for input level
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i]
      }
      const rms = Math.sqrt(sum / dataArray.length)
      const inputLevel = (rms / 255) * 100

      setAudioLevels((prev) => ({ ...prev, input: inputLevel }))

      // Update audio quality based on signal strength
      const quality = Math.min(100, Math.max(0, (inputLevel - 10) * 2))
      updatePerformanceMetrics({ audioQuality: quality })

      animationFrameRef.current = requestAnimationFrame(updateLevels)
    }

    updateLevels()
  }, [updatePerformanceMetrics])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recordingState === "recording") {
      mediaRecorderRef.current.stop()
      setRecordingState("processing")
    }
  }, [recordingState])

  const sendAudioToServer = useCallback((audioBlob: Blob) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(audioBlob)
    }
  }, [])

  const playAudioResponse = useCallback(
    (audioBlob: Blob) => {
      if (isMuted) return

      const audioUrl = URL.createObjectURL(audioBlob)
      const audio = new Audio(audioUrl)

      setIsPlaying(true)
      audio.play()

      // Monitor output audio levels
      const audioContext = new AudioContext()
      const source = audioContext.createMediaElementSource(audio)
      const analyser = audioContext.createAnalyser()

      source.connect(analyser)
      analyser.connect(audioContext.destination)

      const monitorOutput = () => {
        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(dataArray)

        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i]
        }
        const rms = Math.sqrt(sum / dataArray.length)
        const outputLevel = (rms / 255) * 100

        setAudioLevels((prev) => ({ ...prev, output: outputLevel }))

        if (!audio.paused) {
          requestAnimationFrame(monitorOutput)
        }
      }

      monitorOutput()

      audio.onended = () => {
        setIsPlaying(false)
        setRecordingState("idle")
        setAudioLevels((prev) => ({ ...prev, output: 0 }))
        URL.revokeObjectURL(audioUrl)
      }
    },
    [isMuted],
  )

  const handleMicClick = useCallback(() => {
    if (recordingState === "idle") {
      startRecording()
    } else if (recordingState === "recording") {
      stopRecording()
    }
  }, [recordingState, startRecording, stopRecording])

  const toggleMute = useCallback(() => {
    setIsMuted(!isMuted)
  }, [isMuted])

  // Initialize connection on mount
  useEffect(() => {
    connectToServer()

    // Start performance monitoring
    performanceTimerRef.current = window.setInterval(() => {
      // Calculate jitter from latency history
      const recentLatencies = metricsHistoryRef.current.slice(-10).map((m) => m.latency)
      if (recentLatencies.length > 1) {
        const avgLatency = recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length
        const jitter = Math.sqrt(
          recentLatencies.reduce((sum, lat) => sum + Math.pow(lat - avgLatency, 2), 0) / recentLatencies.length,
        )
        updatePerformanceMetrics({ jitter })
      }
    }, 1000)

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      if (performanceTimerRef.current) {
        clearInterval(performanceTimerRef.current)
      }
    }
  }, [connectToServer, updatePerformanceMetrics])

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header with Performance Toggle */}
      <header className="flex justify-between items-center p-6">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-black rounded-sm flex items-center justify-center">
            <span className="text-white text-xs font-bold">R</span>
          </div>
          <span className="font-semibold text-lg">REVOLT</span>
        </div>

        <div className="flex items-center space-x-4">
          {/* Performance Metrics Toggle */}
          <Button
            onClick={() => setShowMetrics(!showMetrics)}
            variant="outline"
            size="sm"
            className="flex items-center space-x-2"
          >
            <Activity className="w-4 h-4" />
            <span>Metrics</span>
          </Button>

          {/* Connection Status */}
          <div className="flex items-center space-x-2">
            {connectionStatus === "connected" ? (
              <Wifi className="w-4 h-4 text-green-500" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-500" />
            )}
            <Badge variant={connectionStatus === "connected" ? "default" : "destructive"} className="capitalize">
              {connectionStatus}
            </Badge>
          </div>
        </div>
      </header>

      {/* Performance Metrics Panel */}
      {showMetrics && (
        <Card className="mx-6 mb-6 p-4">
          <h3 className="font-semibold mb-4">Performance Metrics</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-gray-600">Latency</div>
              <div className="text-lg font-mono">{performanceMetrics.latency.toFixed(0)}ms</div>
              <Progress value={Math.max(0, 100 - performanceMetrics.latency / 20)} className="h-2" />
            </div>
            <div>
              <div className="text-sm text-gray-600">Audio Quality</div>
              <div className="text-lg font-mono">{performanceMetrics.audioQuality.toFixed(0)}%</div>
              <Progress value={performanceMetrics.audioQuality} className="h-2" />
            </div>
            <div>
              <div className="text-sm text-gray-600">Connection</div>
              <div className="text-lg font-mono">{performanceMetrics.connectionStability.toFixed(0)}%</div>
              <Progress value={performanceMetrics.connectionStability} className="h-2" />
            </div>
            <div>
              <div className="text-sm text-gray-600">Response Time</div>
              <div className="text-lg font-mono">{performanceMetrics.responseTime.toFixed(0)}ms</div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Packets Lost</div>
              <div className="text-lg font-mono">{performanceMetrics.packetsLost}</div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Jitter</div>
              <div className="text-lg font-mono">{performanceMetrics.jitter.toFixed(1)}ms</div>
            </div>
          </div>
        </Card>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Robot Avatar */}
        <div className="mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-teal-400 to-blue-500 rounded-full flex items-center justify-center mb-4">
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
              <div className="w-4 h-4 bg-teal-500 rounded-full"></div>
            </div>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-4xl font-bold text-gray-900 mb-8">Talk to Rev</h1>

        {/* Audio Level Indicators */}
        <div className="flex space-x-8 mb-8">
          <div className="text-center">
            <div className="text-sm text-gray-600 mb-2">Input</div>
            <div className="w-4 h-20 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="w-full bg-blue-500 transition-all duration-100 rounded-full"
                style={{ height: `${audioLevels.input}%`, marginTop: `${100 - audioLevels.input}%` }}
              />
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-gray-600 mb-2">Output</div>
            <div className="w-4 h-20 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="w-full bg-green-500 transition-all duration-100 rounded-full"
                style={{ height: `${audioLevels.output}%`, marginTop: `${100 - audioLevels.output}%` }}
              />
            </div>
          </div>
        </div>

        {/* Voice Controls */}
        <div className="flex flex-col items-center space-y-6">
          {/* Main Microphone Button */}
          <Button
            onClick={handleMicClick}
            disabled={connectionStatus !== "connected"}
            className={cn(
              "w-20 h-20 rounded-full transition-all duration-200",
              recordingState === "recording"
                ? "bg-red-500 hover:bg-red-600 animate-pulse"
                : recordingState === "processing"
                  ? "bg-yellow-500 hover:bg-yellow-600"
                  : "bg-blue-500 hover:bg-blue-600",
              connectionStatus !== "connected" && "opacity-50 cursor-not-allowed",
            )}
          >
            {recordingState === "recording" ? (
              <MicOff className="w-8 h-8 text-white" />
            ) : (
              <Mic className="w-8 h-8 text-white" />
            )}
          </Button>

          {/* Status Text */}
          <p className="text-sm text-gray-600 text-center max-w-xs">
            {connectionStatus !== "connected"
              ? "Connecting to server..."
              : recordingState === "recording"
                ? "Listening... Click to stop"
                : recordingState === "processing"
                  ? "Processing your message..."
                  : isPlaying
                    ? "Rev is speaking..."
                    : "Click the microphone to start talking"}
          </p>

          {/* Mute Button */}
          <Button
            onClick={toggleMute}
            variant="outline"
            size="sm"
            className="flex items-center space-x-2 bg-transparent"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            <span>{isMuted ? "Unmute" : "Mute"}</span>
          </Button>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center">
        <p className="text-xs text-gray-500">
          Powered by Gemini Live API • Built for Revolt Motors
          {showMetrics && <span className="ml-2">• Latency: {performanceMetrics.latency.toFixed(0)}ms</span>}
        </p>
      </footer>
    </div>
  )
}
