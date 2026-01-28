/**
 * Type definitions for tool argument and result rendering.
 * 
 * Replaces `any` types with proper generic constraints for better type safety.
 */

import type { JSX } from "solid-js"
import type { Theme } from "@yeshwanthyk/open-tui"
import type { AgentToolResult } from "@yeshwanthyk/ai"

/**
 * Base type for tool arguments - constrains to JSON-serializable values
 */
export type ToolArgs = Record<string, unknown>

/**
 * Base type for tool result content blocks - matches AgentToolResult
 */
export type ToolResultContent = AgentToolResult<unknown>

/**
 * Render options for tool results
 */
export interface RenderResultOptions {
  expanded: boolean
  isPartial: boolean
}

/**
 * Type-safe render function for tool arguments/calls
 */
export type RenderCallFunction<TArgs extends ToolArgs = ToolArgs> = (
  args: TArgs,
  theme: Theme
) => JSX.Element

/**
 * Type-safe render function for tool results
 */
export type RenderResultFunction<TResult = ToolResultContent> = (
  result: TResult,
  opts: RenderResultOptions,
  theme: Theme
) => JSX.Element

/**
 * Generic tool metadata for UI rendering
 */
export interface ToolMeta<TArgs extends ToolArgs = ToolArgs, TDetails = unknown> {
  label: string
  source: "builtin" | "custom"
  sourcePath?: string
  renderCall?: RenderCallFunction<TArgs>
  renderResult?: RenderResultFunction<AgentToolResult<TDetails>>
}