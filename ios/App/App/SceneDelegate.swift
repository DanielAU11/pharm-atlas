import UIKit
import Capacitor
import Network

@objc(PharmAtlasLocalNetworkPlugin)
final class PharmAtlasLocalNetworkPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PharmAtlasLocalNetworkPlugin"
    let jsName = "PharmAtlasLocalNetwork"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "probe", returnType: CAPPluginReturnPromise)
    ]

    private func isPrivateIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) else { return false }
        return parts[0] == 10
            || (parts[0] == 192 && parts[1] == 168)
            || (parts[0] == 172 && (16...31).contains(parts[1]))
    }

    @objc func probe(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), isPrivateIPv4(host) else {
            call.reject("A private IPv4 desktop address is required.")
            return
        }
        let portValue = call.getInt("port") ?? 0
        guard portValue > 0, portValue <= 65_535, let port = NWEndpoint.Port(rawValue: UInt16(portValue)) else {
            call.reject("A valid desktop port is required.")
            return
        }

        let timeoutMilliseconds = min(max(call.getInt("timeoutMs") ?? 30_000, 5_000), 60_000)
        let queue = DispatchQueue(label: "com.pharmatlas.local-network-probe", qos: .userInitiated)
        let completionLock = NSLock()
        var completed = false
        var permissionState = "undetermined"
        var connection: NWConnection?
        var lastConnectionMessage: String?
        let browser = NWBrowser(for: .bonjour(type: "_pharmatlas._tcp", domain: nil), using: .tcp)

        func errorIsPolicyDenied(_ error: NWError) -> Bool {
            if case .dns(let code) = error { return code == -65_570 }
            return false
        }

        func finish(_ status: String, message: String? = nil) {
            completionLock.lock()
            guard !completed else {
                completionLock.unlock()
                return
            }
            completed = true
            completionLock.unlock()
            browser.stateUpdateHandler = nil
            browser.cancel()
            connection?.stateUpdateHandler = nil
            connection?.cancel()
            var result: JSObject = ["status": status, "host": host, "port": portValue]
            if let message { result["message"] = message }
            DispatchQueue.main.async { call.resolve(result) }
        }

        func startConnection() {
            connection?.stateUpdateHandler = nil
            connection?.cancel()
            let nextConnection = NWConnection(host: NWEndpoint.Host(host), port: port, using: .tcp)
            connection = nextConnection
            nextConnection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    finish("allowed")
                case .waiting(let error):
                    if #available(iOS 14.0, *), nextConnection.currentPath?.unsatisfiedReason == .localNetworkDenied {
                        permissionState = "denied"
                    }
                    lastConnectionMessage = error.localizedDescription
                case .failed(let error):
                    if #available(iOS 14.0, *), nextConnection.currentPath?.unsatisfiedReason == .localNetworkDenied {
                        permissionState = "denied"
                    }
                    lastConnectionMessage = error.localizedDescription
                case .cancelled:
                    break
                default:
                    break
                }
            }
            nextConnection.start(queue: queue)
        }

        browser.stateUpdateHandler = { state in
            switch state {
            case .ready:
                permissionState = "allowed"
                startConnection()
            case .waiting(let error):
                if errorIsPolicyDenied(error) { permissionState = "denied" }
            case .failed(let error):
                if errorIsPolicyDenied(error) { permissionState = "denied" }
                else { lastConnectionMessage = error.localizedDescription }
            case .cancelled:
                break
            default:
                break
            }
        }
        browser.start(queue: queue)
        startConnection()
        queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMilliseconds)) {
            if permissionState == "denied" {
                finish("denied", message: "iOS did not grant Local Network access.")
            } else if permissionState == "allowed" {
                finish("unreachable", message: lastConnectionMessage ?? "Local Network access is allowed, but the desktop did not accept the connection.")
            } else {
                finish("timeout", message: "iOS did not complete the Local Network permission request.")
            }
        }
    }
}

final class PharmAtlasBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(PharmAtlasLocalNetworkPlugin())
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = PharmAtlasBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
