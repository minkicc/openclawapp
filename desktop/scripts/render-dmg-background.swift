import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 2 else {
  fputs("usage: swift render-dmg-background.swift <output> [product-name] [icon-path] [width] [height]\n", stderr)
  exit(1)
}

let outputPath = args[1]
let productName = args.count >= 3 ? args[2] : "OpenClaw"
let iconPath = args.count >= 4 ? args[3] : ""
let width = CGFloat(Double(args.count >= 5 ? args[4] : "720") ?? 720)
let height = CGFloat(Double(args.count >= 6 ? args[5] : "460") ?? 460)

let canvas = NSRect(x: 0, y: 0, width: width, height: height)
let image = NSImage(size: canvas.size)

func rgba(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1.0) -> NSColor {
  NSColor(calibratedRed: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
}

image.lockFocus()
guard let context = NSGraphicsContext.current?.cgContext else {
  fputs("failed to create graphics context\n", stderr)
  exit(1)
}

context.setAllowsAntialiasing(true)
context.setShouldAntialias(true)

let backgroundGradient = NSGradient(colors: [
  rgba(250, 252, 255),
  rgba(238, 245, 255),
  rgba(230, 240, 255)
])
backgroundGradient?.draw(in: canvas, angle: 270)

rgba(255, 255, 255, 0.58).setFill()
NSBezierPath(ovalIn: NSRect(x: -40, y: height - 220, width: 280, height: 280)).fill()
NSBezierPath(ovalIn: NSRect(x: width - 220, y: height - 210, width: 260, height: 260)).fill()

let panelShadow = NSShadow()
panelShadow.shadowColor = rgba(34, 63, 118, 0.12)
panelShadow.shadowOffset = NSSize(width: 0, height: -10)
panelShadow.shadowBlurRadius = 28
NSGraphicsContext.saveGraphicsState()
panelShadow.set()

let headerPanel = NSRect(x: 78, y: height - 170, width: width - 156, height: 104)
let leftPanel = NSRect(x: 80, y: 96, width: 215, height: 190)
let rightPanel = NSRect(x: width - 295, y: 96, width: 215, height: 190)

func fillPanel(_ rect: NSRect, alpha: CGFloat = 0.82) {
  let path = NSBezierPath(roundedRect: rect, xRadius: 32, yRadius: 32)
  rgba(255, 255, 255, alpha).setFill()
  path.fill()
  rgba(180, 209, 255, 0.72).setStroke()
  path.lineWidth = 2
  path.stroke()
}

fillPanel(headerPanel, alpha: 0.72)
fillPanel(leftPanel)
fillPanel(rightPanel)
NSGraphicsContext.restoreGraphicsState()

let titleStyle = NSMutableParagraphStyle()
titleStyle.alignment = .center
let subtitleStyle = NSMutableParagraphStyle()
subtitleStyle.alignment = .center

let title = "Install \(productName)"
let subtitle = "Drag \(productName) into Applications to finish setup."

let titleAttributes: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 30, weight: .semibold),
  .foregroundColor: rgba(34, 52, 92),
  .paragraphStyle: titleStyle
]

let subtitleAttributes: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 15, weight: .regular),
  .foregroundColor: rgba(78, 103, 151),
  .paragraphStyle: subtitleStyle
]

title.draw(in: NSRect(x: 120, y: height - 110, width: width - 240, height: 38), withAttributes: titleAttributes)
subtitle.draw(in: NSRect(x: 120, y: height - 142, width: width - 240, height: 24), withAttributes: subtitleAttributes)

if FileManager.default.fileExists(atPath: iconPath), let icon = NSImage(contentsOfFile: iconPath) {
  icon.draw(
    in: NSRect(x: headerPanel.minX + 24, y: headerPanel.midY - 20, width: 40, height: 40),
    from: .zero,
    operation: .sourceOver,
    fraction: 0.22
  )
}

let arrowColor = rgba(56, 139, 255, 0.92)
arrowColor.setFill()

let arrowBody = NSBezierPath(roundedRect: NSRect(x: width / 2 - 58, y: 182, width: 104, height: 22), xRadius: 11, yRadius: 11)
arrowBody.fill()

let arrowHead = NSBezierPath()
arrowHead.move(to: NSPoint(x: width / 2 + 72, y: 193))
arrowHead.line(to: NSPoint(x: width / 2 + 32, y: 227))
arrowHead.line(to: NSPoint(x: width / 2 + 32, y: 159))
arrowHead.close()
arrowHead.fill()

image.unlockFocus()

guard
  let tiffData = image.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiffData),
  let pngData = bitmap.representation(using: .png, properties: [:])
else {
  fputs("failed to encode png\n", stderr)
  exit(1)
}

let outputURL = URL(fileURLWithPath: outputPath)
try FileManager.default.createDirectory(
  at: outputURL.deletingLastPathComponent(),
  withIntermediateDirectories: true,
  attributes: nil
)
try pngData.write(to: outputURL)
