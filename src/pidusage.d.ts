declare module "pidusage" {
  export interface Status {
    cpu: number;
    memory: number;
    elapsed?: number;
  }

  function pidusage(pids: number | number[]): Promise<Record<number, Status>>;

  namespace pidusage {
    export interface Status {
      cpu: number;
      memory: number;
      elapsed?: number;
    }
  }

  export default pidusage;
}
