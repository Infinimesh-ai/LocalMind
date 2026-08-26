//
//  SKUnit+AI.swift
//  AffinePaywall
//
//  Created by qaq on 9/18/25.
//

import Foundation

extension SKUnit {
  static let aiUnits: [SKUnit] = [
    SKUnit(
      category: SKUnitCategory.ai,
      primaryText: "LocalMind AI",
      secondaryText: "A true multimodal AI copilot.",
      package: [
        SKUnitPackageOption(
          price: "...", // Will be populated from App Store
          description: "",
          isDefaultSelected: true,
          primaryTitle: "...", // Will be populated from App Store
          secondaryTitle: "",
          productIdentifier: "app.affine.pro.ai.Annual",
          revenueCatIdentifier: "app.affine.pro.ai.Annual"
        ),
      ]
    ),
  ]
}
