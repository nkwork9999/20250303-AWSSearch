"use client";

import React, { useEffect, useState } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

// ✅ DuckDB の初期化を useEffect で行うカスタムフック
function useDuckDB() {
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);
  const [isDBReady, setIsDBReady] = useState(false);

  useEffect(() => {
    const initDB = async () => {
      try {
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
        const worker = await duckdb.createWorker(bundle.mainWorker ?? "");
        const logger = new duckdb.ConsoleLogger();
        const duckDBInstance = new duckdb.AsyncDuckDB(logger, worker);

        await duckDBInstance.instantiate(
          bundle.mainModule,
          bundle.pthreadWorker
        );
        await duckDBInstance.open({
          path: "opfs://test.db",
          accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
        });

        setDb(duckDBInstance);
        setIsDBReady(true);
        console.log("DuckDB のセットアップが完了しました");
      } catch (error) {
        console.error("DuckDB のセットアップ中にエラーが発生しました:", error);
      }
    };

    initDB();
  }, []);

  return { db, isDBReady };
}

// ✅ OPFS にデータを保存する関数
async function initOPFSDuckDB(db: duckdb.AsyncDuckDB | null) {
  if (!db) return;
  // 1. 取得したいファイルのキー
  const fileKey: string = process.env.NEXT_PUBLIC_FILE_KEY!;

  // 2. プレサインドURLを取得するための自作APIエンドポイント
  const endpoint = `${
    process.env.NEXT_PUBLIC_PRESIGNED_ENDPOINT
  }?key=${encodeURIComponent(fileKey)}`;

  try {
    // DuckDBと接続
    const conn = await db.connect();

    // 3. endpoint を fetch して JSON (presignedUrl) を受け取る
    const presignedResponse = await fetch(endpoint);
    if (!presignedResponse.ok) {
      throw new Error(
        `Failed to get presigned URL: ${presignedResponse.status} ${presignedResponse.statusText}`
      );
    }
    const data = await presignedResponse.json();
    const presignedUrl = data.url;
    if (!presignedUrl) {
      throw new Error("No presigned URL found in response");
    }

    // 4. もらった presignedUrl で Parquetファイルを fetch
    const parquetResponse = await fetch(presignedUrl);
    if (!parquetResponse.ok) {
      throw new Error(
        `Failed to fetch Parquet file: ${parquetResponse.status} ${parquetResponse.statusText}`
      );
    }
    const parquetArrayBuffer = await parquetResponse.arrayBuffer();

    // 5. ファイルバッファを DuckDB に登録してテーブルを作成
    await db.registerFileBuffer(
      "myfile.parquet",
      new Uint8Array(parquetArrayBuffer)
    );
    console.log("データが OPFS にロードされました");

    await conn.query(`
      CREATE OR REPLACE TABLE cost AS 
      SELECT * FROM myfile.parquet;
    `);
  } catch (error) {
    console.error("OPFS へのデータ保存中にエラーが発生しました:", error);
  }
}

// ✅ データを取得する関数
async function downloadFiles(
  db: duckdb.AsyncDuckDB | null,
  setData: React.Dispatch<React.SetStateAction<Record<string, unknown>[]>>,
  setData2: React.Dispatch<React.SetStateAction<Record<string, unknown>[]>>
) {
  if (!db) return;

  try {
    const conn = await db.connect();

    // コストテーブル全件取得
    const queryResult2 = await conn.query(`
      SELECT AWS_SERVICE, LINE_ITEM_USAGE_START_DATE, LINE_ITEM_USAGE_END_DATE, 
             UNBLENDED_COST, CURRENCY, DESCRIPTION
      FROM cost;
    `);
    setData(queryResult2.toArray() as Record<string, unknown>[]);

    // サービス別の合計コスト
    const queryResult3 = await conn.query(`
      SELECT AWS_SERVICE, SUM(UNBLENDED_COST) AS TOTAL_UNBLENDED_COST
      FROM cost
      GROUP BY AWS_SERVICE;
    `);
    setData2(queryResult3.toArray() as Record<string, unknown>[]);

    console.log("データの取得が完了しました");
  } catch (error) {
    console.error("データ取得中にエラーが発生しました:", error);
  }
}

// ✅ React コンポーネント
export default function DownloadFile() {
  const { db, isDBReady } = useDuckDB();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [data2, setData2] = useState<Record<string, unknown>[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState<boolean>(false);

  return (
    <div className="w-full">
      {!isDBReady && <p>DuckDB をセットアップ中...</p>}

      {isDBReady && (
        <>
          {/* ✅ ボタンを横並びにする */}
          <div className="w-full flex justify-center gap-4 mb-4">
            <button
              className={`px-4 py-2 text-white rounded ${
                isDataLoaded ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600"
              }`}
              onClick={async () => {
                if (db) {
                  await initOPFSDuckDB(db);
                  setIsDataLoaded(true);
                }
              }}
              disabled={isDataLoaded}
            >
              データを OPFS へロードする
            </button>

            <button
              className={`px-4 py-2 text-white rounded ${
                !isDataLoaded
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-green-600"
              }`}
              onClick={async () => {
                if (db) {
                  await downloadFiles(db, setData, setData2);
                }
              }}
              disabled={!isDataLoaded}
            >
              OPFS上DBからクエリ
            </button>
          </div>

          <h2 className="text-lg font-bold text-center mb-4">
            1/1 ~ 1/26 AWSサービス別コスト
          </h2>
          <div className="flex justify-center">
            <BarChart width={900} height={300} data={data2}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="AWS_SERVICE" tick={{ fontSize: 12 }} />
              <YAxis
                tickFormatter={(value: number) => value.toLocaleString()}
                label={{
                  value: "Total Unblended Cost",
                  angle: -90,
                  position: "insideLeft",
                }}
              />
              <Bar dataKey="TOTAL_UNBLENDED_COST" fill="#8884d8" />
            </BarChart>
          </div>

          <h2 className="text-lg font-bold text-center mb-4">
            1/1 ~ 1/26 AWSコスト一覧表
          </h2>
          <table className="table-auto border-collapse border border-gray-300">
            <thead>
              <tr>
                <th className="border border-gray-300 p-2">AWS Service</th>
                <th className="border border-gray-300 p-2">Usage Start Date</th>
                <th className="border border-gray-300 p-2">Usage End Date</th>
                <th className="border border-gray-300 p-2">Unblended Cost</th>
                <th className="border border-gray-300 p-2">Currency</th>
                <th className="border border-gray-300 p-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, index) => (
                <tr key={index}>
                  <td className="border border-gray-300 p-2">
                    {row.AWS_SERVICE as string}
                  </td>
                  <td className="border border-gray-300 p-2">
                    {new Date(
                      row.LINE_ITEM_USAGE_START_DATE as string
                    ).toLocaleDateString()}
                  </td>
                  <td className="border border-gray-300 p-2">
                    {new Date(
                      row.LINE_ITEM_USAGE_END_DATE as string
                    ).toLocaleDateString()}
                  </td>
                  <td className="border border-gray-300 p-2">
                    {row.UNBLENDED_COST as number}
                  </td>
                  <td className="border border-gray-300 p-2">
                    {row.CURRENCY as string}
                  </td>
                  <td className="border border-gray-300 p-2">
                    {row.DESCRIPTION as string}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
