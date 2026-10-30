<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json(['service' => 'GET-Employes', 'version' => 'v1']);
});
