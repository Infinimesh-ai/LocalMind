//
//  PricingConfiguration.swift
//  AffinePaywall
//
//  Created by Claude Code on 9/29/25.
//

import Foundation

enum PricingConfiguration {
  static let proMonthly = ProductConfiguration(
    productIdentifier: "ai.infinimesh.localmind.pro.monthly",
    revenueCatIdentifier: "ai.infinimesh.localmind.pro.monthly",
    description: "Monthly",
    isDefaultSelected: false
  )

  static let proAnnual = ProductConfiguration(
    productIdentifier: "ai.infinimesh.localmind.pro.annual",
    revenueCatIdentifier: "ai.infinimesh.localmind.pro.annual",
    description: "Annual",
    badge: "Save 15%",
    isDefaultSelected: true
  )

  static let aiAnnual = ProductConfiguration(
    productIdentifier: "ai.infinimesh.localmind.ai.annual",
    revenueCatIdentifier: "ai.infinimesh.localmind.ai.annual",
    description: "",
    isDefaultSelected: true
  )
}

struct ProductConfiguration {
  let productIdentifier: String
  let revenueCatIdentifier: String
  let description: String
  let badge: String?
  let isDefaultSelected: Bool

  init(
    productIdentifier: String,
    revenueCatIdentifier: String,
    description: String,
    badge: String? = nil,
    isDefaultSelected: Bool = false
  ) {
    self.productIdentifier = productIdentifier
    self.revenueCatIdentifier = revenueCatIdentifier
    self.description = description
    self.badge = badge
    self.isDefaultSelected = isDefaultSelected
  }
}
