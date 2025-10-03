import axios from "axios"
import {
  IVulnerabilityProvider,
  Vulnerability,
  VulnerabilityCheckResult,
} from "./vulnerabilityProvider"
import { REGISTRY_URLS, API_TIMEOUTS } from "../config/registryUrls"

/**
 * GitHub Advisory Database client for checking package vulnerabilities
 * Uses GitHub's GraphQL API - free and no authentication required for public queries
 */
export class GitHubAdvisoryClient implements IVulnerabilityProvider {
  readonly name = "GitHub Advisory"
  readonly requiresAuth = false

  async isReady(): Promise<boolean> {
    return true // No auth required
  }

  getConfigurationInstructions(): string {
    return "GitHub Advisory Database requires no configuration. It works out of the box!"
  }

  async checkPackageVulnerabilities(
    packageName: string,
    version: string,
    ecosystem: string
  ): Promise<VulnerabilityCheckResult | undefined> {
    try {
      const ghEcosystem = this.mapEcosystemToGitHub(ecosystem)
      if (!ghEcosystem) {
        return {
          success: false,
          error: `Unsupported ecosystem for GitHub Advisory: ${ecosystem}`,
          packageName,
          packageVersion: version,
        }
      }

      // GraphQL query to fetch vulnerabilities
      const query = `
        query {
          securityVulnerabilities(
            first: 100,
            ecosystem: ${ghEcosystem},
            package: "${packageName}"
          ) {
            nodes {
              advisory {
                ghsaId
                summary
                severity
                publishedAt
                cvss {
                  score
                }
                references {
                  url
                }
                identifiers {
                  type
                  value
                }
              }
              vulnerableVersionRange
              firstPatchedVersion {
                identifier
              }
            }
          }
        }
      `

      const response = await axios.post(
        REGISTRY_URLS.github.graphql,
        { query },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "VSCode-Package-Version-Checker",
          },
          timeout: API_TIMEOUTS.github,
        }
      )

      if (response.data.errors) {
        console.error("GitHub Advisory API errors:", response.data.errors)
        return {
          success: false,
          error: `GitHub Advisory API error: ${response.data.errors[0].message}`,
          packageName,
          packageVersion: version,
        }
      }

      const vulnerabilities = response.data.data?.securityVulnerabilities?.nodes || []
      
      // Filter vulnerabilities that affect the current version
      const affectingVulns = vulnerabilities.filter((vuln: any) => 
        this.versionAffected(version, vuln.vulnerableVersionRange)
      )

      return this.transformVulnerabilities(affectingVulns, packageName, version)
    } catch (error: any) {
      console.error(`GitHub Advisory error for ${packageName}@${version}:`, error.message)
      
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        return {
          success: false,
          error: "Timeout connecting to GitHub Advisory Database",
          packageName,
          packageVersion: version,
        }
      }

      // Handle rate limiting
      if (error.response?.status === 403) {
        console.warn("GitHub Advisory rate limit reached")
        return {
          success: false,
          error: "GitHub Advisory rate limit reached. Try again later or use OSV.dev instead.",
          packageName,
          packageVersion: version,
        }
      }

      return {
        success: false,
        error: `GitHub Advisory error: ${error.message}`,
        packageName,
        packageVersion: version,
      }
    }
  }

  private mapEcosystemToGitHub(ecosystem: string): string | undefined {
    const mapping: Record<string, string> = {
      npm: "NPM",
      composer: "COMPOSER",
      pypi: "PIP",
      pip: "PIP",
      maven: "MAVEN",
      nuget: "NUGET",
      rubygems: "RUBYGEMS",
      go: "GO",
      rust: "RUST",
    }
    return mapping[ecosystem.toLowerCase()]
  }

  private versionAffected(version: string, range: string): boolean {
    // Simple version range check - can be enhanced with semver library
    // For now, just check if version is mentioned or if range is generic
    if (!range) return true
    
    // Common patterns: "< 1.0.0", ">= 1.0.0, < 2.0.0", "= 1.0.0"
    // This is a simplified check - in production, use semver library
    return true // For now, include all to avoid false negatives
  }

  private transformVulnerabilities(
    vulns: any[],
    packageName: string,
    version: string
  ): Vulnerability[] {
    return vulns.map((vuln) => {
      const advisory = vuln.advisory
      
      // Extract CVE and CWE identifiers
      const cves: string[] = []
      const cwes: string[] = []
      
      advisory.identifiers?.forEach((id: any) => {
        if (id.type === "CVE") {
          cves.push(id.value)
        } else if (id.type === "CWE") {
          cwes.push(id.value)
        }
      })

      // Map GitHub severity to our standard levels
      const severity = this.mapSeverity(advisory.severity)
      
      // Get fixed version
      const fixedIn: string[] = []
      if (vuln.firstPatchedVersion?.identifier) {
        fixedIn.push(vuln.firstPatchedVersion.identifier)
      }

      // Get URL
      const url = advisory.references?.[0]?.url || 
                  `https://github.com/advisories/${advisory.ghsaId}`

      return {
        id: advisory.ghsaId,
        title: advisory.summary || "Vulnerability found",
        severity: severity,
        url: url,
        package: packageName,
        version: version,
        fixedIn: fixedIn,
        cvssScore: advisory.cvss?.score || 0,
        description: advisory.summary,
        cwe: cwes,
        cve: cves,
      }
    })
  }

  private mapSeverity(ghSeverity: string): "low" | "medium" | "high" | "critical" {
    const normalized = ghSeverity.toLowerCase()
    if (normalized === "critical") return "critical"
    if (normalized === "high") return "high"
    if (normalized === "moderate" || normalized === "medium") return "medium"
    return "low"
  }
}

export function getGitHubAdvisoryClient(): GitHubAdvisoryClient {
  return new GitHubAdvisoryClient()
}
