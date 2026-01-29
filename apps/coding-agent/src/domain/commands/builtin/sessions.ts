import type { CommandDefinition } from "../types.js"

export const sessionsCommand: CommandDefinition = {
  name: 'sessions',
  aliases: ['resume'],
  description: 'List and switch to a previous session',
  execute: async (_args, ctx) => {
    if (!ctx.showSelect || !ctx.switchSession) {
      return false
    }
    
    // Get all sessions
    const allSessions = ctx.sessionManager.loadAllSessions()
    
    // Filter out empty and subagent sessions
    const sessions = allSessions.filter(
      (s) => s.messageCount > 0 && !s.firstMessage.startsWith("System context:")
    )
    
    if (sessions.length === 0) {
      return true // No sessions to show
    }
    
    // Format options: "firstMessage (time ago, N msgs)"
    const formatTime = (ts: number): string => {
      const seconds = Math.floor((Date.now() - ts) / 1000)
      if (seconds < 60) return `${seconds}s ago`
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return `${minutes}m ago`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}h ago`
      const days = Math.floor(hours / 24)
      return `${days}d ago`
    }
    
    const options = sessions.map((s) => {
      const title = s.firstMessage.replace(/\n/g, ' ').slice(0, 50)
      const meta = `${formatTime(s.lastActivity)}, ${s.messageCount} msgs`
      return `${title} (${meta})`
    })
    
    const selected = await ctx.showSelect('Sessions', options)
    if (selected === undefined) {
      return true // User cancelled
    }
    
    // Find the session by matching the option string
    const idx = options.indexOf(selected)
    if (idx >= 0 && sessions[idx]) {
      await ctx.switchSession(sessions[idx].path)
    }
    
    return true
  }
}