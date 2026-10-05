#!/usr/bin/env swift
import Foundation
import AppKit

let bundleIdentifier = "com.iconfactory.Tot"
let appPath = "/Applications/Tot.app"
let maxDot = 7

enum TotError: Error, CustomStringConvertible {
    case usage(String)
    case invalidDot(String)
    case writeNeedsAuthorization
    case launchFailed(String)
    case appleEventFailed(Error)

    var description: String {
        switch self {
        case .usage(let message): return message
        case .invalidDot(let value): return "Invalid dot '\(value)'. Dot must be an integer from 1 to 7."
        case .writeNeedsAuthorization:
            return "Refusing to write: pass --authorized only after the user has explicitly approved this exact Tot mutation."
        case .launchFailed(let message): return "Could not launch Tot.app: \(message)"
        case .appleEventFailed(let error): return "AppleEvent failed: \(error)"
        }
    }
}

func fourCharCode(_ s: String) -> AEKeyword {
    var result: UInt32 = 0
    for scalar in s.unicodeScalars.prefix(4) {
        result = (result << 8) + UInt32(scalar.value)
    }
    return result
}

func parseDot(_ value: String) throws -> Int {
    guard let dot = Int(value), dot >= 1, dot <= maxDot else { throw TotError.invalidDot(value) }
    return dot
}

func percentEncodeQueryValue(_ text: String) -> String {
    // Keep Markdown asterisks unescaped. Empirically, Tot's URL handler can
    // preserve `**bold**` markers when `*` is literal, but may store escaped
    // backslashes (`\*\*bold\*\*`) when asterisks are encoded as `%2A`.
    // Keep other query-significant characters encoded so nested Markdown links
    // like `[Home](tot://1)` survive decoding instead of confusing the URL parser.
    let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~*")
    return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
}

func readStdin() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
}

func launchTotIfNeeded() {
    if NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty {
        let url = URL(fileURLWithPath: appPath)
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        let semaphore = DispatchSemaphore(value: 0)
        NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 10)
        // Give Tot a moment to register its AppleEvent handler.
        Thread.sleep(forTimeInterval: 0.7)
    }
}

func sendGURL(_ url: String, timeout: TimeInterval = 30) throws -> String {
    launchTotIfNeeded()
    let target = NSAppleEventDescriptor(bundleIdentifier: bundleIdentifier)
    let event = NSAppleEventDescriptor(
        eventClass: fourCharCode("GURL"),
        eventID: fourCharCode("GURL"),
        targetDescriptor: target,
        returnID: AEReturnID(kAutoGenerateReturnID),
        transactionID: AETransactionID(kAnyTransactionID)
    )
    event.setParam(NSAppleEventDescriptor(string: url), forKeyword: fourCharCode("----"))
    do {
        let reply = try event.sendEvent(options: .waitForReply, timeout: timeout)
        if let direct = reply.paramDescriptor(forKeyword: fourCharCode("----")), let text = direct.stringValue {
            return text
        }
        if let text = reply.stringValue { return text }
        return ""
    } catch {
        throw TotError.appleEventFailed(error)
    }
}

func latestBackupTexts() -> [String]? {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let backupDir = home + "/Library/Containers/com.iconfactory.Tot/Data/Library/Application Support/Tot/Backups"
    guard let files = try? FileManager.default.contentsOfDirectory(atPath: backupDir) else { return nil }
    let jsonFiles = files.filter { $0.hasSuffix(".json") }.map { backupDir + "/" + $0 }
    guard let latest = jsonFiles.max(by: { lhs, rhs in
        let la = (try? FileManager.default.attributesOfItem(atPath: lhs)[.modificationDate] as? Date) ?? .distantPast
        let ra = (try? FileManager.default.attributesOfItem(atPath: rhs)[.modificationDate] as? Date) ?? .distantPast
        return la < ra
    }) else { return nil }
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: latest)),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let dots = object["dots"] as? [[String: Any]] else { return nil }
    return dots.prefix(maxDot).map { $0["text"] as? String ?? "" }
}

func printUsageAndExit() -> Never {
    let usage = """
    Usage:
      totctl.swift read <1-7|all> [--backup-fallback]
      totctl.swift append <1-7> (--text TEXT | --stdin) --authorized
      totctl.swift prepend <1-7> (--text TEXT | --stdin) --authorized
      totctl.swift replace <1-7> (--text TEXT | --stdin) --authorized
      totctl.swift show <1-7>
      totctl.swift raw-url tot://...

    Reads use Tot's AppleEvent URL handler: tot://<dot>/content.
    Writes use tot://<dot>/{append,prepend,replace}?text=<percent-encoded text> and require --authorized.
    """
    fputs(usage + "\n", stderr)
    exit(64)
}

func argumentValue(_ args: [String], _ name: String) -> String? {
    guard let idx = args.firstIndex(of: name), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

func main() throws {
    var args = Array(CommandLine.arguments.dropFirst())
    guard let command = args.first else { printUsageAndExit() }
    args.removeFirst()

    switch command {
    case "read":
        guard let dotArg = args.first else { printUsageAndExit() }
        let allowBackupFallback = args.contains("--backup-fallback")
        if dotArg == "all" {
            var output: [String] = []
            do {
                for dot in 1...maxDot {
                    output.append(try sendGURL("tot://\(dot)/content"))
                }
            } catch {
                if allowBackupFallback, let backup = latestBackupTexts() { output = backup }
                else { throw error }
            }
            let payload = Dictionary(uniqueKeysWithValues: output.enumerated().map { (String($0.offset + 1), $0.element) })
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            print(String(data: data, encoding: .utf8) ?? "{}")
        } else {
            let dot = try parseDot(dotArg)
            do { print(try sendGURL("tot://\(dot)/content"), terminator: "") }
            catch {
                if allowBackupFallback, let backup = latestBackupTexts(), backup.indices.contains(dot - 1) {
                    print(backup[dot - 1], terminator: "")
                } else { throw error }
            }
        }

    case "append", "prepend", "replace":
        guard args.contains("--authorized") else { throw TotError.writeNeedsAuthorization }
        guard let dotArg = args.first else { printUsageAndExit() }
        let dot = try parseDot(dotArg)
        let text: String
        if args.contains("--stdin") { text = readStdin() }
        else if let explicit = argumentValue(args, "--text") { text = explicit }
        else { throw TotError.usage("Missing text. Use --text TEXT or --stdin.") }
        let encoded = percentEncodeQueryValue(text)
        _ = try sendGURL("tot://\(dot)/\(command)?text=\(encoded)")
        print("OK")

    case "show":
        guard let dotArg = args.first else { printUsageAndExit() }
        let dot = try parseDot(dotArg)
        _ = try sendGURL("tot://\(dot)")
        print("OK")

    case "raw-url":
        guard let url = args.first else { printUsageAndExit() }
        print(try sendGURL(url), terminator: "")

    default:
        printUsageAndExit()
    }
}

do {
    try main()
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}
