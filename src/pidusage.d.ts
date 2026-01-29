declare module "pidusage" {
  export interface Status {
    cpu: number;
    memory: number;
    elapsed?: number;
  }

  function pidusage(pid: number): Promise<Status>;
  function pidusage(pids: number[]): Promise<Record<number, Status>>;

  namespace pidusage {
    export interface Status {
      cpu: number;
      memory: number;
      elapsed?: number;
    }
  }

  export default pidusage;
}
