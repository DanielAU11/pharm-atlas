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
        let connection = NWConnection(host: NWEndpoint.Host(host), port: port, using: .tcp)
        let queue = DispatchQueue(label: "com.pharmatlas.local-network-probe", qos: .userInitiated)
        let completionLock = NSLock()
        var completed = false

        func localNetworkDenied() -> Bool {
            if #available(iOS 14.0, *) {
                return connection.currentPath?.unsatisfiedReason == .localNetworkDenied
            }
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
            connection.stateUpdateHandler = nil
            connection.cancel()
            var result: JSObject = ["status": status, "host": host, "port": portValue]
            if let message { result["message"] = message }
            DispatchQueue.main.async { call.resolve(result) }
        }

        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                finish("allowed")
            case .failed(let error):
                finish(localNetworkDenied() ? "denied" : "unreachable", message: error.localizedDescription)
            case .cancelled:
                break
            default:
                // Keep waiting while the Local Network permission sheet is visible.
                break
            }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMilliseconds)) {
            finish(localNetworkDenied() ? "denied" : "timeout", message: "The desktop did not accept a local TCP connection before the permission check timed out.")
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
