import axios from "axios"
import {
  IVulnerabilityProvider,
  Vulnerability,
  VulnerabilityCheckResult,
} from "./vulnerabilityProvider"
import { REGISTRY_URLS, API_TIMEOUTS } from "../config/registryUrls"

/**
 * OSV.dev API client for checking package vulnerabilities
 * OSV (Open Source Vulnerabilities) is a free, open-source vulnerability database
 * No authentication required!
 */
export class OSVClient implements IVulnerabilityProvider {
  readonly name = "OSV.dev"
  readonly requiresAuth = false

  /**
   * OSV doesn't require authentication, so always ready
   */
  async isReady(): Promise<boolean> {
    return true
  }

  /**
   * Gets configuration instructions
   */
  getConfigurationInstructions(): string {
    return "OSV.dev requires no configuration. It works out of the box!"
  }

  /**
   * Tests a package for vulnerabilities using OSV API
   * @param packageName The name of the package to check
   * @param version The version of the package to check
   * @param ecosystem The package ecosystem (npm, composer, pypi, maven, etc.)
   * @returns Promise resolving to VulnerabilityCheckResult or undefined if checking fails
   */
  async checkPackageVulnerabilities(
    packageName: string,
    version: string,
    ecosystem: string
  ): Promise<VulnerabilityCheckResult | undefined> {
    try {
      // Map our ecosystem names to OSV ecosystem identifiers
      const osvEcosystem = this.mapEcosystemToOSV(ecosystem)
      if (!osvEcosystem) {
        const error = `Unsupported ecosystem for OSV vulnerability check: ${ecosystem}`
        console.warn(error)
        return {
          success: false,
          error,
          packageName,
          packageVersion: version,
        }
      }

      // Query OSV API
      const response = await axios.post(
        REGISTRY_URLS.osv.query,
        {
          version: version,
          package: {
            name: packageName,
            ecosystem: osvEcosystem,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: API_TIMEOUTS.osv,
        }
      )

      // Parse vulnerabilities from response
      if (response.data && response.data.vulns) {
        return this.transformVulnerabilities(
          response.data.vulns,
          packageName,
          version
        )
      }

      // No vulnerabilities found
      return []
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error"
      const statusCode = error.response?.status

      console.error(
        `Failed to check OSV vulnerabilities for ${packageName}@${version}:`,
        errorMessage,
        statusCode ? `Status: ${statusCode}` : ""
      )

      // Handle specific error cases
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        return {
          success: false,
          error: `Timeout connecting to OSV.dev. Please try again.`,
          packageName,
          packageVersion: version,
        }
      }

      if (error.response) {
        switch (error.response.status) {
          case 400:
            return {
              success: false,
              error: `Invalid request to OSV.dev for ${packageName}@${version}`,
              statusCode: 400,
              packageName,
              packageVersion: version,
            }
          case 404:
            // Package not found is not an error, just no vulnerabilities
            return []
          case 429:
            return {
              success: false,
              error: `Rate limit exceeded for OSV.dev. Please try again later.`,
              statusCode: 429,
              packageName,
              packageVersion: version,
            }
          case 500:
          case 503:
            return {
              success: false,
              error: `OSV.dev service temporarily unavailable. Please try again later.`,
              statusCode: error.response.status,
              packageName,
              packageVersion: version,
            }
          default:
            return {
              success: false,
              error: `Error checking ${packageName}@${version}: ${statusCode} ${errorMessage}`,
              statusCode: error.response.status,
              packageName,
              packageVersion: version,
            }
        }
      } else {
        // Network errors or other issues
        return {
          success: false,
          error: `Network error checking ${packageName}@${version}: ${errorMessage}`,
          packageName,
          packageVersion: version,
        }
      }
    }
  }

  /**
   * Maps our internal ecosystem names to OSV ecosystem identifiers
   */
  private mapEcosystemToOSV(ecosystem: string): string | undefined {
    const mapping: Record<string, string> = {
      npm: "npm",
      composer: "Packagist",
      pypi: "PyPI",
      pip: "PyPI",
      poetry: "PyPI",
      pub: "Pub",
      maven: "Maven",
      gradle: "Maven",
      cargo: "crates.io",
      nuget: "NuGet",
      golang: "Go",
      go: "Go",
      rubygems: "RubyGems",
      hex: "Hex",
    }

    return mapping[ecosystem.toLowerCase()]
  }

  /**
   * Transforms OSV API vulnerability data to our internal format
   */
  private transformVulnerabilities(
    vulns: any[],
    packageName: string,
    version: string
  ): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = []

    for (const vuln of vulns) {
      // Extract severity
      let severity: "low" | "medium" | "high" | "critical" = "medium"
      let cvssScore = 0

      // OSV uses severity field or CVSS score
      if (vuln.database_specific?.severity) {
        severity = this.normalizeSeverity(vuln.database_specific.severity)
      } else if (vuln.severity) {
        // Some entries have severity array
        const severityEntry = Array.isArray(vuln.severity)
          ? vuln.severity[0]
          : vuln.severity
        
        if (severityEntry?.score) {
          cvssScore = parseFloat(severityEntry.score) || 0
          severity = this.cvssToSeverity(cvssScore)
        } else if (severityEntry?.type === "CVSS_V3") {
          cvssScore = parseFloat(severityEntry.score) || 0
          severity = this.cvssToSeverity(cvssScore)
        }
      }

      // Extract CVE and CWE identifiers
      const cves: string[] = []
      const cwes: string[] = []

      if (vuln.aliases) {
        for (const alias of vuln.aliases) {
          if (alias.startsWith("CVE-")) {
            cves.push(alias)
          }
        }
      }

      if (vuln.database_specific?.cwe_ids) {
        cwes.push(...vuln.database_specific.cwe_ids)
      }

      // Extract fixed versions
      const fixedIn: string[] = []
      if (vuln.affected) {
        for (const affected of vuln.affected) {
          if (affected.ranges) {
            for (const range of affected.ranges) {
              if (range.events) {
                for (const event of range.events) {
                  if (event.fixed) {
                    fixedIn.push(event.fixed)
                  }
                }
              }
            }
          }
          // Also check database_specific for fixed versions
          if (affected.database_specific?.fixed_versions) {
            fixedIn.push(...affected.database_specific.fixed_versions)
          }
        }
      }

      // Get URL
      const url =
        vuln.references?.find((ref: any) => ref.type === "WEB")?.url ||
        vuln.references?.[0]?.url ||
        `https://osv.dev/vulnerability/${vuln.id}`

      vulnerabilities.push({
        id: vuln.id,
        title: vuln.summary || vuln.details?.split("\n")[0] || "Vulnerability found",
        severity: severity,
        url: url,
        package: packageName,
        version: version,
        fixedIn: [...new Set(fixedIn)], // Remove duplicates
        cvssScore: cvssScore,
        description: vuln.details || vuln.summary,
        cwe: cwes,
        cve: cves,
      })
    }

    return vulnerabilities
  }

  /**
   * Normalize severity strings to our standard levels
   */
  private normalizeSeverity(severity: string): "low" | "medium" | "high" | "critical" {
    const normalized = severity.toLowerCase()
    if (normalized.includes("critical")) return "critical"
    if (normalized.includes("high")) return "high"
    if (normalized.includes("medium") || normalized.includes("moderate")) return "medium"
    return "low"
  }

  /**
   * Convert CVSS score to severity level
   */
  private cvssToSeverity(score: number): "low" | "medium" | "high" | "critical" {
    if (score >= 9.0) return "critical"
    if (score >= 7.0) return "high"
    if (score >= 4.0) return "medium"
    return "low"
  }
}

/**
 * Gets an instance of the OSV client
 * @returns OSVClient instance
 */
export function getOSVClient(): OSVClient {
  return new OSVClient()
}
