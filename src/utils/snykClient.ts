import axios from "axios"
import * as vscode from "vscode"

/**
 * Interface representing a vulnerability found by Snyk
 */
export interface SnykVulnerability {
  id: string
  title: string
  severity: "low" | "medium" | "high" | "critical"
  url: string
  package: string
  version: string
  fixedIn: string[]
  cvssScore: number
  description?: string
  cwe?: string[]
  cve?: string[]
}

/**
 * Error response from Snyk API operations
 */
export interface SnykError {
  success: false
  error: string
  statusCode?: number
  packageName: string
  packageVersion: string
}

/**
 * Result of a vulnerability check, either vulnerabilities or error
 */
export type SnykCheckResult = SnykVulnerability[] | SnykError

/**
 * Snyk API client for checking package vulnerabilities
 */
export class SnykClient {
  private apiToken: string | undefined
  private orgId: string | undefined
  private baseUrl = "https://api.snyk.io/v1"
  private apiRateLimit = 180

  constructor() {
    const config = vscode.workspace.getConfiguration("pkgVersion")
    this.apiToken = config.get<string>("snykApiToken")
    this.orgId = config.get<string>("snykOrgId")
  }

  /**
   * Tests if the current API token is valid
   * @returns Promise resolving to boolean indicating if token is valid
   */
  async isTokenValid(): Promise<boolean> {
    if (!this.apiToken) {
      return false
    }

    try {
      const response = await axios.get(`${this.baseUrl}/user`, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      })

      console.log("Snyk API token validation response:", response.status)

      return response.status === 200
    } catch (error: any) {
      console.error("Failed to validate Snyk API token:", error.message)

      if (error.response?.status === 401) {
        vscode.window.showErrorMessage(
          "Snyk API token is invalid. Please check your settings."
        )
      } else if (error.response?.status === 403) {
        vscode.window.showErrorMessage(
          "Snyk API token does not have sufficient permissions."
        )
      }

      return false
    }
  }

  /**
   * Tests a package for vulnerabilities
   * @param packageName The name of the package to check
   * @param version The version of the package to check
   * @param ecosystem The package ecosystem (npm, composer, pypi, maven, etc.)
   * @returns Promise resolving to SnykCheckResult or undefined if checking fails
   */
  async checkPackageVulnerabilities(
    packageName: string,
    version: string,
    ecosystem: string
  ): Promise<SnykCheckResult | undefined> {
    if (!this.apiToken || !this.orgId) {
      const error =
        "Snyk API token or organization ID not configured. Please check extension settings."
      vscode.window.showWarningMessage(error)
      return {
        success: false,
        error,
        packageName,
        packageVersion: version,
      }
    }

    try {
      // The endpoint varies slightly based on the ecosystem
      const packageManager = this.mapEcosystemToPackageManager(ecosystem)
      if (!packageManager) {
        const error = `Unsupported ecosystem for Snyk vulnerability check: ${ecosystem}`
        console.warn(error)
        return {
          success: false,
          error,
          packageName,
          packageVersion: version,
        }
      }

      // Try to use the modern Package URL (purl) based endpoint if available
      // Fall back to the legacy test endpoint if needed
      let response
      try {
        const purl = `pkg:${packageManager}/${packageName}@${version}`
        response = await axios.get(
          `${this.baseUrl}/rest/orgs/${
            this.orgId
          }/packages/${encodeURIComponent(purl)}/issues`,
          {
            headers: {
              Authorization: `Bearer ${this.apiToken}`,
              "Content-Type": "application/json",
            },
            params: {
              version: "2024-01-10", // Current API version
              limit: 1000,
            },
          }
        )
      } catch (purlError: any) {
        // Fall back to legacy endpoint
        console.log(
          "Falling back to legacy test endpoint due to error:",
          purlError.message
        )
        response = await axios.post(
          `${this.baseUrl}/test/${packageManager}`,
          {
            name: packageName,
            version: version,
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiToken}`,
              "Content-Type": "application/json",
            },
          }
        )
      }

      console.log("Snyk API response status:", response.status)

      // Handle response based on the endpoint that succeeded
      if (response.data?.data) {
        // New API format (purl endpoint)
        return this.transformModernVulnerabilities(
          response.data.data,
          packageName,
          version
        )
      } else if (response.data?.issues) {
        // Legacy API format
        return this.transformVulnerabilities(
          response.data.issues,
          packageName,
          version
        )
      }

      return []
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error"
      const statusCode = error.response?.status
      const responseData = error.response?.data || {}

      console.error(
        `Failed to check vulnerabilities for ${packageName}@${version}:`,
        errorMessage,
        statusCode ? `Status: ${statusCode}` : "",
        responseData
      )

      let userMessage: string

      // Handle different HTTP error codes based on documentation
      if (error.response) {
        switch (error.response.status) {
          case 400:
            if (responseData.errors?.[0]?.detail?.includes("Invalid PURL")) {
              userMessage = `Invalid package URL format for ${packageName}@${version}.`
            } else if (
              responseData.errors?.[0]?.detail?.includes(
                "Unsupported Ecosystem"
              )
            ) {
              userMessage = `Unsupported ecosystem: ${ecosystem}. Snyk doesn't support this package type.`
            } else if (
              responseData.errors?.[0]?.detail?.includes("namespace")
            ) {
              userMessage = `Package ${packageName} requires a namespace specification.`
            } else if (
              responseData.errors?.[0]?.detail?.includes(
                "component not supported"
              )
            ) {
              userMessage = `Package URL contains unsupported components.`
            } else if (
              responseData.errors?.[0]?.detail?.includes("pagination")
            ) {
              userMessage = `Invalid pagination parameters in request.`
            } else {
              userMessage = `Invalid request: ${
                responseData.errors?.[0]?.detail || errorMessage
              }`
            }
            break
          case 401:
            userMessage =
              "Snyk API authentication failed. Please check your API token."
            break
          case 403:
            // Specific handling for organization permissions
            userMessage =
              "Access forbidden. Your Snyk token may not have sufficient permissions"
            if (
              responseData.errors?.[0]?.detail?.includes(
                "organization is not authorized"
              )
            ) {
              userMessage =
                "Your organization is not authorized to perform this action. Contact your Snyk administrator."
            } else if (responseData.message) {
              userMessage += `: ${responseData.message}`
            } else if (responseData.error) {
              userMessage += `: ${responseData.error}`
            } else if (responseData.errors?.[0]?.detail) {
              userMessage += `: ${responseData.errors[0].detail}`
            }
            // Ensure we return the error response instead of empty array
            vscode.window.showErrorMessage(userMessage)
            return {
              success: false,
              error: userMessage,
              statusCode: 403,
              packageName,
              packageVersion: version,
            }
            break
          case 404:
            userMessage = `Package ${packageName}@${version} not found in ${ecosystem} ecosystem.`
            break
          case 429:
            userMessage = `Rate limit exceeded for Snyk API. Maximum of ${this.apiRateLimit} requests per minute are allowed. Please try again later.`
            break
          case 500:
            if (
              responseData.errors?.[0]?.detail?.includes(
                "Authorization request failure"
              )
            ) {
              userMessage =
                "Authorization request failure. This is a temporary issue with the Snyk service."
            } else if (
              responseData.errors?.[0]?.detail?.includes(
                "Vulnerability service error"
              )
            ) {
              userMessage =
                "Vulnerability service error. This is a temporary issue with the Snyk service."
            } else {
              userMessage =
                "Internal server error from Snyk API. This is a temporary issue with the service."
            }
            break
          case 503:
            userMessage =
              "Vulnerability service unavailable. This is a temporary issue with the Snyk service."
            break
          default:
            userMessage = `Error checking ${packageName}@${version}: ${statusCode} ${errorMessage}`
        }

        vscode.window.showErrorMessage(userMessage)

        return {
          success: false,
          error: userMessage,
          statusCode: error.response.status,
          packageName,
          packageVersion: version,
        }
      } else {
        // Network errors or other issues
        userMessage = `Network error checking ${packageName}@${version}: ${errorMessage}`
        vscode.window.showErrorMessage(userMessage)

        return {
          success: false,
          error: userMessage,
          packageName,
          packageVersion: version,
        }
      }
    }
  }

  /**
   * Maps our internal ecosystem names to Snyk package manager identifiers
   */
  private mapEcosystemToPackageManager(ecosystem: string): string | undefined {
    const mapping: Record<string, string> = {
      npm: "npm",
      composer: "composer",
      pypi: "pypi", // Changed from 'pip' to 'pypi' based on Snyk docs
      pub: "swift", // Updated from rubygems to swift for pub.dev
      maven: "maven",
      gradle: "maven", // Using maven for gradle packages
      cargo: "cargo",
      nuget: "nuget",
      golang: "golang",
      hex: "hex",
      rubygems: "gem",
      cocoapods: "cocoapods",
      apk: "apk",
      deb: "deb",
      rpm: "rpm",
      generic: "generic", // For unmanaged C/C++ dependencies
    }

    return mapping[ecosystem.toLowerCase()]
  }

  /**
   * Transforms Snyk API vulnerability data to our internal format (legacy format)
   */
  private transformVulnerabilities(
    issues: any[],
    packageName: string,
    version: string
  ): SnykVulnerability[] {
    const vulnerabilities: SnykVulnerability[] = []

    for (const issue of issues) {
      if (issue.type === "vulnerability") {
        vulnerabilities.push({
          id: issue.id,
          title: issue.title,
          severity: issue.severity,
          url: issue.url,
          package: packageName,
          version: version,
          fixedIn: issue.fixedIn || [],
          cvssScore: issue.cvssScore || 0,
          description: issue.description,
          cwe: issue.identifiers?.CWE || [],
          cve: issue.identifiers?.CVE || [],
        })
      }
    }

    return vulnerabilities
  }

  /**
   * Transforms modern Snyk API vulnerability data (from the issues endpoint) to our internal format
   */
  private transformModernVulnerabilities(
    issues: any[],
    packageName: string,
    version: string
  ): SnykVulnerability[] {
    const vulnerabilities: SnykVulnerability[] = []

    for (const issue of issues) {
      if (issue.type === "issue") {
        // Extract CVE and CWE identifiers
        const cves: string[] = []
        const cwes: string[] = []

        if (issue.problems) {
          for (const problem of issue.problems) {
            if (problem.source === "CVE") {
              cves.push(problem.id)
            } else if (problem.source === "CWE") {
              cwes.push(problem.id)
            }
          }
        }

        // Find primary severity
        let severity: "low" | "medium" | "high" | "critical" = "medium"
        let cvssScore = 0

        if (issue.severities && issue.severities.length > 0) {
          // Prefer CVSS v4 primary severity if available
          const primarySeverity =
            issue.severities.find(
              (s: any) => s.type === "primary" && s.version === "4.0"
            ) ||
            issue.severities.find((s: any) => s.type === "primary") ||
            issue.severities[0]

          severity = primarySeverity.level
          cvssScore = primarySeverity.score
        }

        // Extract fixed versions
        const fixedIn: string[] = []
        if (issue.coordinates && issue.coordinates.length > 0) {
          for (const coordinate of issue.coordinates) {
            if (coordinate.remedies && coordinate.remedies.length > 0) {
              for (const remedy of coordinate.remedies) {
                if (remedy.details?.upgrade_package) {
                  const versions = remedy.details.upgrade_package.split(",")
                  fixedIn.push(...versions)
                }
              }
            }
          }
        }

        vulnerabilities.push({
          id: issue.id,
          title: issue.title,
          severity: severity,
          url:
            issue.references?.[0]?.url ||
            `https://security.snyk.io/vuln/${issue.id}`,
          package: packageName,
          version: version,
          fixedIn: fixedIn,
          cvssScore: cvssScore,
          description: issue.description,
          cwe: cwes,
          cve: cves,
        })
      }
    }

    return vulnerabilities
  }
}

/**
 * Gets an instance of the Snyk client
 * @returns SnykClient instance
 */
export function getSnykClient(): SnykClient {
  return new SnykClient()
}
