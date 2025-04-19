import axios from "axios";
import * as vscode from "vscode";

/**
 * Interface representing a vulnerability found by Snyk
 */
export interface SnykVulnerability {
  id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  url: string;
  package: string;
  version: string;
  fixedIn: string[];
  cvssScore: number;
  description?: string;
}

/**
 * Snyk API client for checking package vulnerabilities
 */
export class SnykClient {
  private apiToken: string | undefined;
  private baseUrl = "https://snyk.io/api/v1";
  
  constructor() {
    this.apiToken = vscode.workspace.getConfiguration("pkgVersion").get<string>("snykApiToken");
  }
  
  /**
   * Tests if the current API token is valid
   * @returns Promise resolving to boolean indicating if token is valid
   */
  async isTokenValid(): Promise<boolean> {
    if (!this.apiToken) {
      return false;
    }
    
    try {
      const response = await axios.get(`${this.baseUrl}/user`, {
        headers: {
          Authorization: `token ${this.apiToken}`
        }
      });
      
      return response.status === 200;
    } catch (error) {
      console.error("Failed to validate Snyk API token:", error);
      return false;
    }
  }
  
  /**
   * Tests a package for vulnerabilities
   * @param packageName The name of the package to check
   * @param version The version of the package to check
   * @param ecosystem The package ecosystem (npm, composer, pypi, maven, etc.)
   * @returns Promise resolving to array of vulnerabilities or undefined if checking fails
   */
  async checkPackageVulnerabilities(
    packageName: string,
    version: string,
    ecosystem: string
  ): Promise<SnykVulnerability[] | undefined> {
    if (!this.apiToken) {
      vscode.window.showWarningMessage(
        "Snyk API token not configured. Please add token in extension settings."
      );
      return undefined;
    }
    
    try {
      // The endpoint varies slightly based on the ecosystem
      const packageManager = this.mapEcosystemToPackageManager(ecosystem);
      if (!packageManager) {
        console.warn(`Unsupported ecosystem for Snyk vulnerability check: ${ecosystem}`);
        return undefined;
      }
      
      const response = await axios.post(
        `${this.baseUrl}/test/${packageManager}`,
        {
          name: packageName,
          version: version
        },
        {
          headers: {
            Authorization: `token ${this.apiToken}`,
            "Content-Type": "application/json"
          }
        }
      );
      
      if (response.data && response.data.issues) {
        // Transform Snyk API response to our vulnerability interface
        return this.transformVulnerabilities(response.data.issues, packageName, version);
      }
      
      return [];
    } catch (error: any) {
      console.error(
        `Failed to check vulnerabilities for ${packageName}@${version}:`,
        error.message
      );
      
      // Check if this is an authentication error
      if (error.response && error.response.status === 401) {
        vscode.window.showErrorMessage(
          "Snyk API authentication failed. Please check your API token."
        );
      }
      
      return undefined;
    }
  }
  
  /**
   * Maps our internal ecosystem names to Snyk package manager identifiers
   */
  private mapEcosystemToPackageManager(ecosystem: string): string | undefined {
    const mapping: Record<string, string> = {
      npm: "npm",
      composer: "composer",
      pypi: "pip",
      pub: "rubygems", // This may need updating when Snyk supports pub.dev
      maven: "maven",
      gradle: "gradle",
      cargo: "cargo"
    };
    
    return mapping[ecosystem.toLowerCase()];
  }
  
  /**
   * Transforms Snyk API vulnerability data to our internal format
   */
  private transformVulnerabilities(
    issues: any[],
    packageName: string,
    version: string
  ): SnykVulnerability[] {
    const vulnerabilities: SnykVulnerability[] = [];
    
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
          description: issue.description
        });
      }
    }
    
    return vulnerabilities;
  }
}

/**
 * Gets an instance of the Snyk client
 * @returns SnykClient instance
 */
export function getSnykClient(): SnykClient {
  return new SnykClient();
} 