// Performance testing script for Revolt Voice Chat
const WebSocket = require("ws")

class PerformanceTester {
  constructor(serverUrl = "ws://localhost:3001/voice") {
    this.serverUrl = serverUrl
    this.metrics = {
      connectionTime: 0,
      messageLatencies: [],
      reconnectionCount: 0,
      errorCount: 0,
    }
  }

  async runTest(duration = 60000) {
    console.log("🚀 Starting Revolt Voice Chat Performance Test")
    console.log(`📊 Test Duration: ${duration / 1000} seconds`)
    console.log(`🔗 Server URL: ${this.serverUrl}`)
    console.log("=" * 50)

    const startTime = Date.now()
    let testRunning = true

    // Stop test after duration
    setTimeout(() => {
      testRunning = false
    }, duration)

    while (testRunning) {
      await this.testConnection()
      await new Promise((resolve) => setTimeout(resolve, 5000)) // Wait 5s between tests
    }

    this.generateReport()
  }

  async testConnection() {
    return new Promise((resolve) => {
      const connectionStart = Date.now()
      const ws = new WebSocket(this.serverUrl)

      ws.on("open", () => {
        this.metrics.connectionTime = Date.now() - connectionStart
        console.log(`✅ Connected in ${this.metrics.connectionTime}ms`)

        // Test message latency
        this.testMessageLatency(ws, resolve)
      })

      ws.on("error", (error) => {
        this.metrics.errorCount++
        console.log(`❌ Connection error: ${error.message}`)
        resolve()
      })

      ws.on("close", () => {
        this.metrics.reconnectionCount++
      })
    })
  }

  testMessageLatency(ws, resolve) {
    const messageStart = Date.now()

    // Send test audio data (mock)
    const testAudio = Buffer.alloc(1024, 0)
    ws.send(testAudio)

    ws.on("message", (data) => {
      const latency = Date.now() - messageStart
      this.metrics.messageLatencies.push(latency)
      console.log(`📨 Message latency: ${latency}ms`)

      ws.close()
      resolve()
    })

    // Timeout after 10 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
        this.metrics.errorCount++
        console.log("⏰ Message timeout")
      }
      resolve()
    }, 10000)
  }

  generateReport() {
    console.log("\n" + "=" * 50)
    console.log("📈 PERFORMANCE REPORT")
    console.log("=" * 50)

    const avgLatency =
      this.metrics.messageLatencies.length > 0
        ? this.metrics.messageLatencies.reduce((a, b) => a + b, 0) / this.metrics.messageLatencies.length
        : 0

    const minLatency = Math.min(...this.metrics.messageLatencies)
    const maxLatency = Math.max(...this.metrics.messageLatencies)

    console.log(`🔗 Average Connection Time: ${this.metrics.connectionTime}ms`)
    console.log(`📊 Average Message Latency: ${avgLatency.toFixed(2)}ms`)
    console.log(`⚡ Min Latency: ${minLatency}ms`)
    console.log(`🐌 Max Latency: ${maxLatency}ms`)
    console.log(`🔄 Reconnections: ${this.metrics.reconnectionCount}`)
    console.log(`❌ Errors: ${this.metrics.errorCount}`)
    console.log(`📈 Total Messages: ${this.metrics.messageLatencies.length}`)

    // Performance assessment
    console.log("\n🎯 PERFORMANCE ASSESSMENT:")
    if (avgLatency < 1000) {
      console.log("✅ EXCELLENT - Latency under 1 second")
    } else if (avgLatency < 2000) {
      console.log("✅ GOOD - Latency under 2 seconds")
    } else {
      console.log("⚠️  NEEDS IMPROVEMENT - Latency over 2 seconds")
    }

    if (this.metrics.errorCount === 0) {
      console.log("✅ EXCELLENT - No errors detected")
    } else if (this.metrics.errorCount < 3) {
      console.log("✅ GOOD - Minimal errors")
    } else {
      console.log("⚠️  NEEDS IMPROVEMENT - Multiple errors detected")
    }
  }
}

// Run the test
if (require.main === module) {
  const tester = new PerformanceTester()
  tester.runTest(60000) // Run for 1 minute
}

module.exports = PerformanceTester
