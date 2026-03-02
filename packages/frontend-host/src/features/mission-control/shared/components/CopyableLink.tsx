import * as React from "react"
import { Copy } from "@carbon/icons-react"
import { useNavigate } from "react-router-dom"

interface CopyableLinkProps {
  /** Full value to copy and use for navigation */
  fullValue: string
  /** Optional truncated display value. If not provided, will auto-truncate if > 19 chars */
  displayValue?: string
  /** Navigation path. If provided, clicking the link navigates to this path */
  navigateTo?: string
  /** Whether the row is currently hovered (controls copy icon visibility) */
  isHovered: boolean
  /** Max length before truncation (default: 19) */
  maxLength?: number
  /** If true, opens the link in a new tab instead of navigating */
  openInNewTab?: boolean
}

/**
 * A centered link with a copy icon that appears on hover.
 * Used in data tables for Instance IDs and similar copyable values.
 */
export function CopyableLink({
  fullValue,
  displayValue,
  navigateTo,
  isHovered,
  maxLength = 19,
  openInNewTab = false,
}: CopyableLinkProps) {
  const navigate = useNavigate()

  const truncatedValue = displayValue ?? (
    fullValue.length > maxLength
      ? `${fullValue.substring(0, 8)}...${fullValue.substring(fullValue.length - 6)}`
      : fullValue
  )

  const handleClick = () => {
    if (navigateTo) {
      if (openInNewTab) {
        window.open(navigateTo, '_blank')
      } else {
        navigate(navigateTo)
      }
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(fullValue)
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "flex-start" }}>
      <button
        className="cds--link"
        style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: "12px" }}
        onClick={handleClick}
        title={fullValue}
      >
        {truncatedValue}
      </button>
      <button
        style={{
          border: "none",
          background: "transparent",
          padding: "2px",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          width: "20px",
          minWidth: "20px",
          opacity: isHovered ? 1 : 0,
          pointerEvents: isHovered ? "auto" : "none",
        }}
        onClick={handleCopy}
        title="Copy to clipboard"
      >
        <Copy size={16} />
      </button>
    </div>
  )
}
