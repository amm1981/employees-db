<?php

use App\Http\Controllers\DatasetController;
use App\Http\Controllers\SyncController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->middleware(['service.token', 'throttle:120,1'])->group(function () {
    Route::post('sync/runs', [SyncController::class, 'create']);
    Route::get('sync/runs/{runId}', [SyncController::class, 'show']);
    Route::get('sync/runs/{runId}/batches', [SyncController::class, 'batches']);
    Route::put('sync/runs/{runId}/batches/{batchNumber}', [SyncController::class, 'batch']);
    Route::post('sync/runs/{runId}/finalize', [SyncController::class, 'finalize']);
    Route::post('sync/runs/{runId}/publish', [SyncController::class, 'publish']);
    Route::post('sync/runs/{runId}/cancel', [SyncController::class, 'cancel']);
    Route::get('datasets', [DatasetController::class, 'index']);
    Route::get('datasets/{datasetId}/records', [DatasetController::class, 'records']);
    Route::get('datasets/{datasetId}/publications', [DatasetController::class, 'publications']);
    Route::post('datasets/{datasetId}/rollback', [DatasetController::class, 'rollback']);
});
