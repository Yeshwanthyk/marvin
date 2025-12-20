/**
 * Spacer component - flexible space that grows to fill available space
 */

export interface SpacerProps {
	/** Flex grow factor (default: 1) */
	grow?: number
	/** Minimum height in lines */
	minHeight?: number
	/** Minimum width in columns */
	minWidth?: number
}

/**
 * Flexible spacer that expands to fill available space
 *
 * @example
 * ```tsx
 * <box flexDirection="row">
 *   <text>Left</text>
 *   <Spacer />
 *   <text>Right</text>
 * </box>
 * ```
 */
export function Spacer(props: SpacerProps) {
	// Build props object without undefined values to satisfy exactOptionalPropertyTypes
	const boxProps: { flexGrow: number; minHeight?: number; minWidth?: number } = {
		flexGrow: props.grow ?? 1,
	}
	if (props.minHeight !== undefined) boxProps.minHeight = props.minHeight
	if (props.minWidth !== undefined) boxProps.minWidth = props.minWidth

	return <box {...boxProps} />
}
