# contextforge-benchmark-v1 reference artifacts

These source-free artifacts are the first formal run of `contextforge-benchmark-v1` against implementation commit `8790fecebe4c9026afdf0e5a6d03cfe7f69cb35d` and frozen dataset hash `75685087e8392840b4bb61ae19cef9ccb92df66844e79e0e87a0b7c6437a0002`.

- `quality-results.json`: all 360 task/system/budget cases; SHA-256 `175ec7327dba2880324dad56d8d055fba2f09992a957bfe754607c6d9c1394a6`.
- `aggregate-results.json`: deterministic aggregate metrics; SHA-256 `a3cd681db283fd7a34522f7254247ffd4320abefb54ab6cae5ee4918bf4915a3`.
- `benchmark-report.md`: deterministic generated quality report; SHA-256 `e6283faeb037f39151351b0b1abdbf054385dbeccf46fce9a41afa3f1f070023`.
- `performance-results.json`: three environment-specific timing repetitions; SHA-256 `f8933cda8eb48077b74cb65ee30ba8bd155ff92cc51bbb3aeac824098aec858d`.

The final quality run was repeated immediately and the first three hashes matched exactly. Performance is intentionally not part of the determinism assertion. Regenerate working artifacts with `npm run benchmark` and `npm run benchmark:performance`; those commands write to ignored `.benchmark-output/` and do not overwrite this reviewed reference directory.
