/**
 * Updated WaveConfiguration with Secure File Access permissions
 */
export interface WaveConfiguration {
  // ... existing fields ...
  permissions?: {
    /** List of allowed tool call patterns */
    allow?: string[];
    /** 
     * List of directories that are considered part of the Safe Zone.
     * File operations within these directories can be auto-accepted.
     */
    additionalDirectories?: string[];
  };
  // ... existing fields ...
}
