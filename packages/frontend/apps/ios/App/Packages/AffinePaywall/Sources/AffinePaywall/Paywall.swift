//
//  Paywall.swift
//  AffinePaywall
//
//  Created by qaq on 9/18/25.
//

import RevenueCat
import SwiftUI
import UIKit
import WebKit

public enum Paywall {
  package static var revenueCatToken: String? {
    configurationValue(for: "LocalMindRevenueCatAPIKey")
  }

  package static var revenueCatProxyEndpoint: URL? {
    guard let value = configurationValue(for: "LocalMindRevenueCatProxyURL") else { return nil }
    return URL(string: value)
  }
  package static var isPurchasesConfigured = false

  private static let setupExecution: Void = {
    #if DEBUG
      Purchases.logLevel = .debug
    #endif
    if let proxyURL = revenueCatProxyEndpoint {
      Purchases.proxyURL = proxyURL
    }
    return ()
  }()

  nonisolated
  public static func setup() {
    _ = setupExecution
  }

  @MainActor
  public static func presentWall(
    toController controller: UIViewController,
    bindWebContext context: WKWebView?,
    type: String
  ) {
    guard revenueCatToken != nil else {
      let alert = UIAlertController(
        title: "LocalMind subscriptions unavailable",
        message: "In-app purchases are not configured for this LocalMind build.",
        preferredStyle: .alert
      )
      alert.addAction(UIAlertAction(title: "OK", style: .default))
      controller.present(alert, animated: true)
      return
    }
    let viewModel = ViewModel()
    if let context { viewModel.bind(context: context) }
    switch type.lowercased() {
    case "pro":
      viewModel.select(category: .pro)
      viewModel.select(subcategory: SKUnitSubcategoryProPlan.default)
    case "ai":
      viewModel.select(category: .ai)
      viewModel.select(subcategory: SKUnitSingleSubcategory.single)
    default:
      break
    }
    let view = AffinePaywallPageView(viewModel: viewModel)
    let hostingController = UIHostingController(rootView: view)
    viewModel.bind(controller: hostingController)
    hostingController.modalPresentationStyle = .overFullScreen
    hostingController.modalTransitionStyle = .coverVertical
    hostingController.preferredContentSize = CGSize(width: 555, height: 555) // for iPads
    controller.present(hostingController, animated: true)
  }

  private static func configurationValue(for key: String) -> String? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, !trimmed.hasPrefix("$(") else { return nil }
    return trimmed
  }
}
