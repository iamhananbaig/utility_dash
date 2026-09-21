<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Location extends Model
{
    protected $fillable = ['code', 'name', 'city'];

    public function properties(): HasMany
    {
        return $this->hasMany(Property::class);
    }
}
